from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import BookPlacement, Bookcase, Shelf
from app.schemas.bookcase import (
    BookcaseCreate,
    BookcaseRead,
    BookcaseUpdate,
    ShelfCreate,
    ShelfRead,
    ShelfReorderRequest,
    ShelfUpdate,
)

router = APIRouter(prefix="/api", tags=["bookcases"])


def _serialize_shelf(shelf: Shelf) -> ShelfRead:
    placements = shelf.placements or []
    used_mm = sum((p.book.width_mm or 25.0) for p in placements if p.book is not None)
    return ShelfRead(
        id=shelf.id,
        bookcase_id=shelf.bookcase_id,
        label=shelf.label,
        position_index=shelf.position_index,
        width_cm=shelf.width_cm,
        height_cm=shelf.height_cm,
        depth_cm=shelf.depth_cm,
        notes=shelf.notes,
        book_count=len(placements),
        used_width_cm=round(used_mm / 10.0, 2),
        created_at=shelf.created_at,
        updated_at=shelf.updated_at,
    )


def _serialize_bookcase(bookcase: Bookcase) -> BookcaseRead:
    shelves = [_serialize_shelf(s) for s in sorted(bookcase.shelves, key=lambda s: s.position_index)]
    return BookcaseRead(
        id=bookcase.id,
        name=bookcase.name,
        location=bookcase.location,
        notes=bookcase.notes,
        shelves=shelves,
        total_books=sum(s.book_count for s in shelves),
        total_width_cm=round(sum(s.width_cm for s in shelves), 2),
        created_at=bookcase.created_at,
        updated_at=bookcase.updated_at,
    )


def _get_bookcase_or_404(db: Session, bookcase_id: int) -> Bookcase:
    stmt = (
        select(Bookcase)
        .options(
            selectinload(Bookcase.shelves)
            .selectinload(Shelf.placements)
            .selectinload(BookPlacement.book)
        )
        .where(Bookcase.id == bookcase_id)
    )
    bookcase = db.scalar(stmt)
    if not bookcase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Estantería no encontrada")
    return bookcase


def _get_shelf_or_404(db: Session, shelf_id: int) -> Shelf:
    stmt = (
        select(Shelf)
        .options(selectinload(Shelf.placements).selectinload(BookPlacement.book))
        .where(Shelf.id == shelf_id)
    )
    shelf = db.scalar(stmt)
    if not shelf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balda no encontrada")
    return shelf


@router.get("/bookcases", response_model=list[BookcaseRead])
def list_bookcases(db: Session = Depends(get_db)) -> list[BookcaseRead]:
    stmt = (
        select(Bookcase)
        .options(
            selectinload(Bookcase.shelves)
            .selectinload(Shelf.placements)
            .selectinload(BookPlacement.book)
        )
        .order_by(Bookcase.id)
    )
    bookcases = db.scalars(stmt).all()
    return [_serialize_bookcase(bc) for bc in bookcases]


@router.post("/bookcases", response_model=BookcaseRead, status_code=status.HTTP_201_CREATED)
def create_bookcase(payload: BookcaseCreate, db: Session = Depends(get_db)) -> BookcaseRead:
    bookcase = Bookcase(
        name=payload.name.strip(),
        location=payload.location.strip() if payload.location else None,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(bookcase)
    db.flush()

    if payload.initial_shelves:
        cfg = payload.initial_shelves
        for idx in range(cfg.count):
            db.add(
                Shelf(
                    bookcase_id=bookcase.id,
                    label=f"Balda {idx + 1}",
                    position_index=idx,
                    width_cm=cfg.width_cm,
                    height_cm=cfg.height_cm,
                    depth_cm=cfg.depth_cm,
                )
            )

    db.commit()
    return _serialize_bookcase(_get_bookcase_or_404(db, bookcase.id))


@router.get("/bookcases/{bookcase_id}", response_model=BookcaseRead)
def get_bookcase(bookcase_id: int, db: Session = Depends(get_db)) -> BookcaseRead:
    return _serialize_bookcase(_get_bookcase_or_404(db, bookcase_id))


@router.patch("/bookcases/{bookcase_id}", response_model=BookcaseRead)
def update_bookcase(
    bookcase_id: int, payload: BookcaseUpdate, db: Session = Depends(get_db)
) -> BookcaseRead:
    bookcase = _get_bookcase_or_404(db, bookcase_id)
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if isinstance(value, str):
            value = value.strip() or None if field != "name" else value.strip()
        setattr(bookcase, field, value)
    db.commit()
    return _serialize_bookcase(_get_bookcase_or_404(db, bookcase_id))


@router.delete("/bookcases/{bookcase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bookcase(bookcase_id: int, db: Session = Depends(get_db)) -> None:
    bookcase = _get_bookcase_or_404(db, bookcase_id)
    db.delete(bookcase)
    db.commit()


@router.post(
    "/bookcases/{bookcase_id}/shelves",
    response_model=ShelfRead,
    status_code=status.HTTP_201_CREATED,
)
def create_shelf(
    bookcase_id: int, payload: ShelfCreate, db: Session = Depends(get_db)
) -> ShelfRead:
    bookcase = _get_bookcase_or_404(db, bookcase_id)
    next_index = (
        payload.position_index
        if payload.position_index is not None
        else len(bookcase.shelves)
    )
    shelf = Shelf(
        bookcase_id=bookcase.id,
        label=payload.label.strip(),
        position_index=next_index,
        width_cm=payload.width_cm,
        height_cm=payload.height_cm,
        depth_cm=payload.depth_cm,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(shelf)
    db.commit()
    return _serialize_shelf(_get_shelf_or_404(db, shelf.id))


@router.put("/bookcases/{bookcase_id}/shelves/reorder", response_model=BookcaseRead)
def reorder_shelves(
    bookcase_id: int, payload: ShelfReorderRequest, db: Session = Depends(get_db)
) -> BookcaseRead:
    bookcase = _get_bookcase_or_404(db, bookcase_id)
    existing_ids = {s.id for s in bookcase.shelves}
    if set(payload.shelf_ids) != existing_ids or len(payload.shelf_ids) != len(existing_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La lista de IDs debe incluir exactamente todas las baldas de la estantería",
        )
    shelf_by_id = {s.id: s for s in bookcase.shelves}
    for idx, shelf_id in enumerate(payload.shelf_ids):
        shelf_by_id[shelf_id].position_index = idx
    db.commit()
    return _serialize_bookcase(_get_bookcase_or_404(db, bookcase_id))


@router.patch("/shelves/{shelf_id}", response_model=ShelfRead)
def update_shelf(
    shelf_id: int, payload: ShelfUpdate, db: Session = Depends(get_db)
) -> ShelfRead:
    shelf = _get_shelf_or_404(db, shelf_id)
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if isinstance(value, str):
            value = value.strip() or None if field == "notes" else value.strip()
        setattr(shelf, field, value)
    db.commit()
    return _serialize_shelf(_get_shelf_or_404(db, shelf_id))


@router.delete("/shelves/{shelf_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shelf(shelf_id: int, db: Session = Depends(get_db)) -> None:
    shelf = _get_shelf_or_404(db, shelf_id)
    bookcase_id = shelf.bookcase_id
    db.delete(shelf)
    db.flush()

    # Re-normalize position_index for remaining shelves
    remaining = db.scalars(
        select(Shelf)
        .where(Shelf.bookcase_id == bookcase_id)
        .order_by(Shelf.position_index, Shelf.id)
    ).all()
    for idx, s in enumerate(remaining):
        s.position_index = idx
    db.commit()
