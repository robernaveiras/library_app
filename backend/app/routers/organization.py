import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Book, BookPlacement, BookTag, Bookcase, OrganizationPlan, Shelf, Tag
from app.schemas.organization import (
    AISuggestRequest,
    AISuggestResponse,
    MoveStep,
    OrganizationCriteria,
    OrganizationPreviewResponse,
    PlanCreateRequest,
    PlanDetailRead,
    PlanStepProgressUpdate,
    PlanSummaryRead,
    TargetPlacementRecord,
)
from app.services.ai_providers import AIProviderError, get_ai_provider
from app.services.organizer import compute_organization_preview, suggest_organization_with_ai

router = APIRouter(prefix="/api/organization", tags=["organization"])


def _load_library_state(db: Session) -> tuple[list[Bookcase], list[Book], list[Tag]]:
    bookcases = list(
        db.scalars(
            select(Bookcase)
            .options(selectinload(Bookcase.shelves))
            .order_by(Bookcase.id)
        ).all()
    )
    books = list(
        db.scalars(
            select(Book)
            .options(
                selectinload(Book.placement)
                .selectinload(BookPlacement.shelf)
                .selectinload(Shelf.bookcase),
                selectinload(Book.book_tags).selectinload(BookTag.tag),
            )
            .order_by(Book.id)
        ).all()
    )
    tags = list(
        db.scalars(select(Tag).options(selectinload(Tag.book_tags)).order_by(Tag.id)).all()
    )
    return bookcases, books, tags


def _deserialize_plan_detail(plan: OrganizationPlan) -> PlanDetailRead:
    criteria = OrganizationCriteria.model_validate_json(plan.criteria_json)
    # Full preview snapshot is stored inside target_placements_json when created
    raw_snapshot = json.loads(plan.target_placements_json or "{}")
    if isinstance(raw_snapshot, dict) and "after_bookcases" in raw_snapshot:
        preview = OrganizationPreviewResponse.model_validate(raw_snapshot)
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El plan guardado tiene un formato incompatible.",
        )

    # Sync latest step done flags from move_steps_json
    try:
        stored_steps = [
            MoveStep.model_validate(s) for s in json.loads(plan.move_steps_json or "[]")
        ]
        if stored_steps:
            preview = preview.model_copy(update={"move_steps": stored_steps})
    except Exception:
        pass

    return PlanDetailRead(
        id=plan.id,
        name=plan.name,
        description=plan.description,
        status=plan.status,
        criteria=criteria,
        preview=preview,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def _serialize_plan_summary(plan: OrganizationPlan) -> PlanSummaryRead:
    try:
        steps = json.loads(plan.move_steps_json or "[]")
        if not isinstance(steps, list):
            steps = []
    except json.JSONDecodeError:
        steps = []

    total_steps = len(steps)
    completed_steps = sum(1 for s in steps if isinstance(s, dict) and s.get("done") is True)

    books_moved = 0
    try:
        snap = json.loads(plan.target_placements_json or "{}")
        if isinstance(snap, dict):
            books_moved = int((snap.get("metrics") or {}).get("books_moved", 0))
    except Exception:
        pass

    return PlanSummaryRead(
        id=plan.id,
        name=plan.name,
        description=plan.description,
        status=plan.status,
        total_steps=total_steps,
        completed_steps=completed_steps,
        books_moved=books_moved,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def _get_plan_or_404(db: Session, plan_id: int) -> OrganizationPlan:
    plan = db.get(OrganizationPlan, plan_id)
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Plan de organización no encontrado"
        )
    return plan


@router.post("/suggest", response_model=AISuggestResponse)
async def suggest_organization(
    payload: AISuggestRequest = AISuggestRequest(),
    db: Session = Depends(get_db),
) -> AISuggestResponse:
    bookcases, books, tags = _load_library_state(db)
    if not bookcases or not books:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Necesitas al menos una estantería y libros en tu inventario para pedir sugerencias.",
        )

    try:
        ai = get_ai_provider(provider_id=payload.provider, model_override=payload.model)
    except AIProviderError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        suggestions = await suggest_organization_with_ai(
            ai=ai,
            bookcases=bookcases,
            books=books,
            tags=tags,
            user_goal=payload.user_goal,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return AISuggestResponse(
        ai_provider=ai.provider_id,
        ai_model=ai.model,
        suggestions=suggestions,
    )


@router.post("/preview", response_model=OrganizationPreviewResponse)
def preview_organization(
    criteria: OrganizationCriteria,
    db: Session = Depends(get_db),
) -> OrganizationPreviewResponse:
    bookcases, books, tags = _load_library_state(db)
    return compute_organization_preview(
        bookcases=bookcases,
        books=books,
        tags=tags,
        criteria=criteria,
    )


@router.get("/plans", response_model=list[PlanSummaryRead])
def list_plans(db: Session = Depends(get_db)) -> list[PlanSummaryRead]:
    plans = db.scalars(
        select(OrganizationPlan).order_by(OrganizationPlan.updated_at.desc(), OrganizationPlan.id.desc())
    ).all()
    return [_serialize_plan_summary(p) for p in plans]


@router.post("/plans", response_model=PlanDetailRead, status_code=status.HTTP_201_CREATED)
def create_plan(
    payload: PlanCreateRequest,
    db: Session = Depends(get_db),
) -> PlanDetailRead:
    bookcases, books, tags = _load_library_state(db)
    preview = compute_organization_preview(
        bookcases=bookcases,
        books=books,
        tags=tags,
        criteria=payload.criteria,
    )
    plan_name = (payload.name or payload.criteria.name or "Plan de organización").strip()
    plan_desc = payload.description if payload.description is not None else payload.criteria.description

    plan = OrganizationPlan(
        name=plan_name,
        description=plan_desc.strip() if plan_desc else None,
        status="draft",
        criteria_json=payload.criteria.model_dump_json(),
        target_placements_json=preview.model_dump_json(),
        move_steps_json=json.dumps(
            [s.model_dump() for s in preview.move_steps], ensure_ascii=False
        ),
        warnings_json=json.dumps(preview.warnings, ensure_ascii=False),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _deserialize_plan_detail(plan)


@router.get("/plans/{plan_id}", response_model=PlanDetailRead)
def get_plan(plan_id: int, db: Session = Depends(get_db)) -> PlanDetailRead:
    plan = _get_plan_or_404(db, plan_id)
    return _deserialize_plan_detail(plan)


@router.patch("/plans/{plan_id}/steps", response_model=PlanDetailRead)
def update_plan_step_progress(
    plan_id: int,
    payload: PlanStepProgressUpdate,
    db: Session = Depends(get_db),
) -> PlanDetailRead:
    plan = _get_plan_or_404(db, plan_id)
    steps = [MoveStep.model_validate(s) for s in json.loads(plan.move_steps_json or "[]")]
    found = False
    for step in steps:
        if step.id == payload.step_id:
            step.done = payload.done
            found = True
            break
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Paso de movimiento no encontrado"
        )

    plan.move_steps_json = json.dumps([s.model_dump() for s in steps], ensure_ascii=False)
    if plan.status != "applied":
        plan.status = "in_progress" if any(s.done for s in steps) else "draft"

    db.commit()
    db.refresh(plan)
    return _deserialize_plan_detail(plan)


@router.post("/plans/{plan_id}/apply", response_model=PlanDetailRead)
def apply_plan(plan_id: int, db: Session = Depends(get_db)) -> PlanDetailRead:
    plan = _get_plan_or_404(db, plan_id)
    detail = _deserialize_plan_detail(plan)

    target_records: list[TargetPlacementRecord] = detail.preview.target_placements
    if not target_records:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El plan no contiene ubicaciones destino para aplicar.",
        )

    valid_shelf_ids = set(db.scalars(select(Shelf.id)).all())
    existing_books = {
        b.id: b
        for b in db.scalars(select(Book).options(selectinload(Book.placement))).all()
    }

    for rec in target_records:
        if rec.shelf_id not in valid_shelf_ids:
            continue
        book = existing_books.get(rec.book_id)
        if not book:
            continue
        if book.placement is not None:
            book.placement.shelf_id = rec.shelf_id
            book.placement.position_index = rec.position_index
        else:
            db.add(
                BookPlacement(
                    book_id=book.id,
                    shelf_id=rec.shelf_id,
                    position_index=rec.position_index,
                    orientation="vertical",
                    row_depth=1,
                )
            )

    # Mark all steps done & plan applied
    steps = [MoveStep.model_validate(s) for s in json.loads(plan.move_steps_json or "[]")]
    for s in steps:
        s.done = True
    plan.move_steps_json = json.dumps([s.model_dump() for s in steps], ensure_ascii=False)
    plan.status = "applied"

    db.commit()
    db.refresh(plan)
    return _deserialize_plan_detail(plan)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: int, db: Session = Depends(get_db)) -> None:
    plan = _get_plan_or_404(db, plan_id)
    db.delete(plan)
    db.commit()
