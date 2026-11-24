import json
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Book, BookTag, Tag
from app.routers.books import (
    _book_query,
    _get_book_or_404,
    _load_authors,
    _load_extra_attributes,
    serialize_book,
)
from app.schemas.book import BookRead
from app.schemas.tag import (
    AICategorizeRequest,
    AICategorizeResponse,
    BookSetTagsRequest,
    TagAssignRequest,
    TagCreate,
    TagEvaluationRequest,
    TagEvaluationResponse,
    TagMatchProposal,
    TagRead,
    TagUpdate,
)
from app.services.ai_providers import AIProviderError, get_ai_provider
from app.services.categorizer import categorize_books_batch, evaluate_tag_rule_batch

router = APIRouter(prefix="/api", tags=["tags"])


def _serialize_tag(tag: Tag) -> TagRead:
    return TagRead(
        id=tag.id,
        name=tag.name,
        description=tag.description,
        color_hex=tag.color_hex,
        ai_rule_prompt=tag.ai_rule_prompt,
        book_count=len(tag.book_tags or []),
        created_at=tag.created_at,
    )


def _get_tag_or_404(db: Session, tag_id: int) -> Tag:
    tag = db.scalar(
        select(Tag).options(selectinload(Tag.book_tags)).where(Tag.id == tag_id)
    )
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoría no encontrada")
    return tag


def _book_to_ai_payload(book: Book) -> dict[str, object]:
    payload: dict[str, object] = {
        "book_id": book.id,
        "title": book.title,
        "authors": _load_authors(book),
    }
    if book.subtitle:
        payload["subtitle"] = book.subtitle
    if book.publisher:
        payload["publisher"] = book.publisher
    if book.published_year:
        payload["published_year"] = book.published_year
    if book.language:
        payload["language"] = book.language
    if book.page_count:
        payload["page_count"] = book.page_count
    if book.genre:
        payload["current_genre"] = book.genre
    if book.subgenre:
        payload["current_subgenre"] = book.subgenre
    if book.series_name:
        payload["series_name"] = book.series_name
    if book.reading_status and book.reading_status != "unknown":
        payload["reading_status"] = book.reading_status
    extra = _load_extra_attributes(book)
    if extra:
        payload["attributes"] = extra
    if book.synopsis:
        payload["synopsis"] = book.synopsis[:240]
    return payload


@router.get("/tags", response_model=list[TagRead])
def list_tags(db: Session = Depends(get_db)) -> list[TagRead]:
    tags = db.scalars(
        select(Tag).options(selectinload(Tag.book_tags)).order_by(func.lower(Tag.name))
    ).all()
    return [_serialize_tag(t) for t in tags]


@router.post("/tags", response_model=TagRead, status_code=status.HTTP_201_CREATED)
def create_tag(payload: TagCreate, db: Session = Depends(get_db)) -> TagRead:
    clean_name = payload.name.strip()
    existing = db.scalar(select(Tag).where(func.lower(Tag.name) == clean_name.lower()))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe una categoría llamada '{existing.name}'.",
        )
    tag = Tag(
        name=clean_name,
        description=payload.description.strip() if payload.description else None,
        color_hex=payload.color_hex,
        ai_rule_prompt=payload.ai_rule_prompt.strip() if payload.ai_rule_prompt else None,
    )
    db.add(tag)
    db.commit()
    return _serialize_tag(_get_tag_or_404(db, tag.id))


@router.patch("/tags/{tag_id}", response_model=TagRead)
def update_tag(tag_id: int, payload: TagUpdate, db: Session = Depends(get_db)) -> TagRead:
    tag = _get_tag_or_404(db, tag_id)
    data = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"] is not None:
        new_name = data["name"].strip()
        dup = db.scalar(
            select(Tag).where(func.lower(Tag.name) == new_name.lower(), Tag.id != tag_id)
        )
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe otra categoría llamada '{dup.name}'.",
            )
        tag.name = new_name

    if "description" in data:
        tag.description = data["description"].strip() if data["description"] else None
    if "color_hex" in data and data["color_hex"]:
        tag.color_hex = data["color_hex"]
    if "ai_rule_prompt" in data:
        tag.ai_rule_prompt = data["ai_rule_prompt"].strip() if data["ai_rule_prompt"] else None

    db.commit()
    return _serialize_tag(_get_tag_or_404(db, tag_id))


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: int, db: Session = Depends(get_db)) -> None:
    tag = _get_tag_or_404(db, tag_id)
    db.delete(tag)
    db.commit()


@router.get("/tags/{tag_id}/books", response_model=list[int])
def list_tag_book_ids(tag_id: int, db: Session = Depends(get_db)) -> list[int]:
    tag = _get_tag_or_404(db, tag_id)
    return [bt.book_id for bt in tag.book_tags]


@router.post("/tags/{tag_id}/assign", response_model=TagRead)
def assign_books_to_tag(
    tag_id: int, payload: TagAssignRequest, db: Session = Depends(get_db)
) -> TagRead:
    tag = _get_tag_or_404(db, tag_id)
    existing_by_book = {bt.book_id: bt for bt in tag.book_tags}

    if payload.remove_book_ids:
        for bid in payload.remove_book_ids:
            bt = existing_by_book.get(bid)
            if bt is not None:
                db.delete(bt)

    if payload.add_book_ids:
        valid_book_ids = set(
            db.scalars(select(Book.id).where(Book.id.in_(payload.add_book_ids))).all()
        )
        for bid in payload.add_book_ids:
            if bid not in valid_book_ids:
                continue
            if bid not in existing_by_book:
                db.add(BookTag(book_id=bid, tag_id=tag.id, source=payload.source))

    db.commit()
    return _serialize_tag(_get_tag_or_404(db, tag_id))


@router.put("/books/{book_id}/tags", response_model=BookRead)
def set_book_tags(
    book_id: int, payload: BookSetTagsRequest, db: Session = Depends(get_db)
) -> BookRead:
    book = _get_book_or_404(db, book_id)
    desired_ids = set(payload.tag_ids)

    valid_tag_ids = set(
        db.scalars(select(Tag.id).where(Tag.id.in_(desired_ids))).all()
    ) if desired_ids else set()

    current_by_tag = {bt.tag_id: bt for bt in book.book_tags}

    for tid, bt in current_by_tag.items():
        if tid not in valid_tag_ids:
            db.delete(bt)

    for tid in valid_tag_ids:
        if tid not in current_by_tag:
            db.add(BookTag(book_id=book.id, tag_id=tid, source="manual"))

    db.commit()
    return serialize_book(_get_book_or_404(db, book_id))


@router.post("/tags/{tag_id}/evaluate", response_model=TagEvaluationResponse)
async def evaluate_tag_with_ai(
    tag_id: int,
    payload: TagEvaluationRequest = TagEvaluationRequest(),
    db: Session = Depends(get_db),
) -> TagEvaluationResponse:
    tag = _get_tag_or_404(db, tag_id)
    rule = (payload.rule_override or tag.ai_rule_prompt or tag.description or tag.name).strip()
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Define una regla o descripción para evaluar esta categoría con IA.",
        )

    try:
        ai = get_ai_provider(provider_id=payload.provider, model_override=payload.model)
    except AIProviderError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    books = db.scalars(_book_query().order_by(Book.id)).all()
    if not books:
        return TagEvaluationResponse(
            tag_id=tag.id,
            tag_name=tag.name,
            rule_used=rule,
            ai_provider=ai.provider_id,
            ai_model=ai.model,
            evaluated_books=0,
            proposals=[],
            applied_count=0,
        )

    book_payloads = [_book_to_ai_payload(b) for b in books]
    try:
        matches = await evaluate_tag_rule_batch(
            ai=ai,
            tag_name=tag.name,
            rule_prompt=rule,
            book_payloads=book_payloads,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    books_by_id = {b.id: b for b in books}
    assigned_ids = {bt.book_id for bt in tag.book_tags}

    proposals: list[TagMatchProposal] = []
    applied_count = 0
    for m in matches:
        book = books_by_id.get(m.book_id)
        if not book:
            continue
        already = m.book_id in assigned_ids
        if payload.auto_apply and m.confidence >= payload.min_confidence and not already:
            db.add(BookTag(book_id=book.id, tag_id=tag.id, source="ai_confirmed"))
            assigned_ids.add(book.id)
            already = True
            applied_count += 1

        proposals.append(
            TagMatchProposal(
                book_id=book.id,
                title=book.title,
                authors=_load_authors(book),
                confidence=m.confidence,
                reason=m.reason,
                already_assigned=already,
            )
        )

    if applied_count > 0:
        db.commit()

    return TagEvaluationResponse(
        tag_id=tag.id,
        tag_name=tag.name,
        rule_used=rule,
        ai_provider=ai.provider_id,
        ai_model=ai.model,
        evaluated_books=len(books),
        proposals=proposals,
        applied_count=applied_count,
    )


@router.post("/books/categorize-ai", response_model=AICategorizeResponse)
async def categorize_books_with_ai(
    payload: AICategorizeRequest = AICategorizeRequest(),
    db: Session = Depends(get_db),
) -> AICategorizeResponse:
    try:
        ai = get_ai_provider(provider_id=payload.provider, model_override=payload.model)
    except AIProviderError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    stmt = _book_query().order_by(Book.id)
    if payload.book_ids:
        stmt = stmt.where(Book.id.in_(payload.book_ids))
    all_books = db.scalars(stmt).all()

    existing_genres = sorted({b.genre for b in all_books if b.genre})

    targets: list[Book] = []
    skipped = 0
    for b in all_books:
        if payload.only_missing and not payload.overwrite and b.genre and b.subgenre:
            skipped += 1
            continue
        targets.append(b)

    if not targets:
        return AICategorizeResponse(
            ai_provider=ai.provider_id,
            ai_model=ai.model,
            processed=0,
            updated=0,
            skipped=skipped,
            errors=0,
            genres_summary=dict(Counter(b.genre for b in all_books if b.genre)),
        )

    book_payloads = [_book_to_ai_payload(b) for b in targets]
    try:
        results = await categorize_books_batch(
            ai=ai,
            book_payloads=book_payloads,
            existing_genres=existing_genres,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    updated = 0
    errors = 0
    for book in targets:
        res = results.get(book.id)
        if not res:
            errors += 1
            continue

        changed = False
        if res.genre and (payload.overwrite or not book.genre):
            if book.genre != res.genre:
                book.genre = res.genre
                changed = True
        if res.subgenre and (payload.overwrite or not book.subgenre):
            if book.subgenre != res.subgenre:
                book.subgenre = res.subgenre
                changed = True
        if res.series_name and (payload.overwrite or not book.series_name):
            if book.series_name != res.series_name:
                book.series_name = res.series_name
                changed = True
        if res.series_index is not None and (payload.overwrite or book.series_index is None):
            if book.series_index != res.series_index:
                book.series_index = res.series_index
                changed = True

        if res.extra_attributes:
            current_extra = _load_extra_attributes(book)
            merged_extra = {**current_extra}
            for k, v in res.extra_attributes.items():
                if payload.overwrite or k not in merged_extra or not merged_extra[k]:
                    merged_extra[k] = v
            new_json = json.dumps(merged_extra, ensure_ascii=False)
            if new_json != book.extra_attributes_json:
                book.extra_attributes_json = new_json
                changed = True

        if changed:
            updated += 1

    db.commit()

    refreshed_books = db.scalars(select(Book)).all()
    genres_counter = Counter(b.genre for b in refreshed_books if b.genre)

    return AICategorizeResponse(
        ai_provider=ai.provider_id,
        ai_model=ai.model,
        processed=len(targets),
        updated=updated,
        skipped=skipped,
        errors=errors,
        genres_summary=dict(sorted(genres_counter.items(), key=lambda kv: (-kv[1], kv[0]))),
    )
