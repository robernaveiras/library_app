import asyncio
import json
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Book, BookPlacement, BookTag, Shelf
from app.schemas.book import (
    BatchEnrichRequest,
    BatchEnrichResponse,
    BookCreate,
    BookPlacementInfo,
    BookRead,
    BookTagBrief,
    BookUpdate,
    EnrichBookRequest,
    EnrichBookResponse,
    EnrichmentStatus,
    InventoryStats,
)
from app.services.enrichment import EnrichmentCandidate, fetch_book_enrichment
from app.services.isbn_lookup import estimate_thickness_from_pages

router = APIRouter(prefix="/api", tags=["books"])


def _load_authors(book: Book) -> list[str]:
    try:
        parsed = json.loads(book.authors_json or "[]")
        return [str(a) for a in parsed] if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def _load_extra_attributes(book: Book) -> dict[str, object]:
    try:
        parsed = json.loads(book.extra_attributes_json or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _set_extra_attributes(book: Book, updates: dict[str, object]) -> None:
    current = _load_extra_attributes(book)
    current.update(updates)
    book.extra_attributes_json = json.dumps(current, ensure_ascii=False)


def _get_enrichment_status(book: Book) -> EnrichmentStatus:
    extra = _load_extra_attributes(book)
    stored = extra.get("enrichment_status")

    # Objective metadata signals (books enriched via ISBN scan or external APIs)
    signals = sum(
        [
            bool(book.cover_url),
            bool(book.isbn_13 or book.isbn_10),
            bool(book.page_count),
            bool(book.synopsis),
            bool(book.publisher and book.published_year),
        ]
    )
    if signals >= 2 or stored == "enriched":
        return "enriched"
    if stored == "not_found":
        return "not_found"
    return "pending"


def _needs_enrichment(book: Book) -> bool:
    return _get_enrichment_status(book) == "pending"


def serialize_book(book: Book) -> BookRead:
    placement_info: Optional[BookPlacementInfo] = None
    if book.placement and book.placement.shelf and book.placement.shelf.bookcase:
        p = book.placement
        s = p.shelf
        bc = s.bookcase
        placement_info = BookPlacementInfo(
            placement_id=p.id,
            bookcase_id=bc.id,
            bookcase_name=bc.name,
            shelf_id=s.id,
            shelf_label=s.label,
            position_index=p.position_index,
            orientation=p.orientation,  # type: ignore[arg-type]
            row_depth=p.row_depth,
            confidence=p.confidence,
        )

    tags = [
        BookTagBrief(
            id=bt.tag.id,
            name=bt.tag.name,
            color_hex=bt.tag.color_hex,
            source=bt.source,
        )
        for bt in (book.book_tags or [])
        if bt.tag is not None
    ]

    enrich_status = _get_enrichment_status(book)
    return BookRead(
        id=book.id,
        title=book.title,
        subtitle=book.subtitle,
        authors=_load_authors(book),
        publisher=book.publisher,
        published_year=book.published_year,
        language=book.language,
        isbn_10=book.isbn_10,
        isbn_13=book.isbn_13,
        page_count=book.page_count,
        width_mm=book.width_mm,
        height_mm=book.height_mm,
        dimensions_source=book.dimensions_source,
        cover_url=book.cover_url,
        synopsis=book.synopsis,
        genre=book.genre,
        subgenre=book.subgenre,
        series_name=book.series_name,
        series_index=book.series_index,
        reading_status=book.reading_status,  # type: ignore[arg-type]
        extra_attributes=_load_extra_attributes(book),
        placement=placement_info,
        tags=tags,
        enrichment_status=enrich_status,
        needs_enrichment=enrich_status == "pending",
        created_at=book.created_at,
        updated_at=book.updated_at,
    )


def _book_query():
    return select(Book).options(
        selectinload(Book.placement).selectinload(BookPlacement.shelf).selectinload(Shelf.bookcase),
        selectinload(Book.book_tags).selectinload(BookTag.tag),
    )


def _get_book_or_404(db: Session, book_id: int) -> Book:
    book = db.scalar(_book_query().where(Book.id == book_id))
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Libro no encontrado")
    return book


def _renormalize_shelf_positions(db: Session, shelf_id: int) -> None:
    placements = db.scalars(
        select(BookPlacement)
        .where(BookPlacement.shelf_id == shelf_id)
        .order_by(BookPlacement.position_index, BookPlacement.id)
    ).all()
    for idx, p in enumerate(placements):
        p.position_index = idx


def apply_enrichment_to_book(
    book: Book, candidate: EnrichmentCandidate, overwrite: bool = False
) -> list[str]:
    updated: list[str] = []

    def set_if(attr: str, value: object) -> None:
        if value is None or value == "":
            return
        current = getattr(book, attr)
        if overwrite or not current:
            if current != value:
                setattr(book, attr, value)
                updated.append(attr)

    set_if("subtitle", candidate.subtitle)
    set_if("publisher", candidate.publisher)
    set_if("published_year", candidate.published_year)
    set_if("language", candidate.language.lower() if candidate.language else None)
    set_if("isbn_10", candidate.isbn_10)
    set_if("isbn_13", candidate.isbn_13)
    set_if("page_count", candidate.page_count)
    set_if("cover_url", candidate.cover_url)
    set_if("synopsis", candidate.synopsis)

    current_authors = _load_authors(book)
    if candidate.authors and (overwrite or not current_authors):
        new_authors_json = json.dumps(candidate.authors, ensure_ascii=False)
        if new_authors_json != book.authors_json:
            book.authors_json = new_authors_json
            updated.append("authors")

    # Physical dimensions: never overwrite user's manual measurements
    if book.dimensions_source != "manual":
        if candidate.dimensions_source == "api":
            if candidate.width_mm and (overwrite or book.width_mm is None or book.dimensions_source != "api"):
                book.width_mm = candidate.width_mm
                book.dimensions_source = "api"
                updated.append("width_mm")
            if candidate.height_mm and (overwrite or book.height_mm is None or book.dimensions_source != "api"):
                book.height_mm = candidate.height_mm
                book.dimensions_source = "api"
                updated.append("height_mm")
        else:
            est_w = candidate.width_mm or estimate_thickness_from_pages(book.page_count)
            if est_w and (book.width_mm is None or (overwrite and book.dimensions_source == "estimated")):
                book.width_mm = est_w
                if not book.dimensions_source:
                    book.dimensions_source = "estimated"
                updated.append("width_mm")

    # Fill initial genre if completely empty and Google Books provided a clean category
    if not book.genre and candidate.categories:
        raw_cat = candidate.categories[0].split("/")[0].strip()
        if raw_cat:
            book.genre = raw_cat[:100]
            updated.append("genre")

    return updated


@router.get("/books/stats", response_model=InventoryStats)
def get_inventory_stats(db: Session = Depends(get_db)) -> InventoryStats:
    books = db.scalars(_book_query()).all()
    placed = 0
    enriched = 0
    pending = 0
    not_found = 0
    unread = 0
    reading = 0
    read = 0
    total_width_mm = 0.0
    languages: set[str] = set()
    genres: set[str] = set()

    for b in books:
        if b.placement is not None:
            placed += 1
        est = _get_enrichment_status(b)
        if est == "enriched":
            enriched += 1
        elif est == "not_found":
            not_found += 1
        else:
            pending += 1
        if b.reading_status == "unread":
            unread += 1
        elif b.reading_status == "reading":
            reading += 1
        elif b.reading_status == "read":
            read += 1
        total_width_mm += b.width_mm or 25.0
        if b.language:
            languages.add(b.language.lower())
        if b.genre:
            genres.add(b.genre)

    return InventoryStats(
        total_books=len(books),
        placed_books=placed,
        enriched_books=enriched,
        needs_enrichment_count=pending,
        not_found_enrichment_count=not_found,
        unread_count=unread,
        reading_count=reading,
        read_count=read,
        estimated_linear_meters=round(total_width_mm / 1000.0, 2),
        languages=sorted(languages),
        genres=sorted(genres),
    )


@router.get("/books", response_model=list[BookRead])
def list_books(
    q: Optional[str] = Query(None, description="Búsqueda en título, autor, editorial, ISBN o saga"),
    bookcase_id: Optional[int] = Query(None),
    shelf_id: Optional[int] = Query(None),
    reading_status: Optional[str] = Query(None),
    genre: Optional[str] = Query(None),
    language: Optional[str] = Query(None),
    tag_id: Optional[int] = Query(None),
    enrichment: Literal["all", "enriched", "pending", "not_found", "missing_metadata"] = Query("all"),
    sort_by: Literal["location", "title", "author", "year", "pages", "created_at"] = Query("location"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    db: Session = Depends(get_db),
) -> list[BookRead]:
    books = db.scalars(_book_query()).all()
    serialized = [serialize_book(b) for b in books]

    # Filtering
    if q and q.strip():
        needle = q.strip().lower()
        serialized = [
            b
            for b in serialized
            if needle in b.title.lower()
            or (b.subtitle and needle in b.subtitle.lower())
            or any(needle in a.lower() for a in b.authors)
            or (b.publisher and needle in b.publisher.lower())
            or (b.isbn_13 and needle in b.isbn_13.lower())
            or (b.isbn_10 and needle in b.isbn_10.lower())
            or (b.genre and needle in b.genre.lower())
            or (b.series_name and needle in b.series_name.lower())
        ]

    if bookcase_id is not None:
        serialized = [b for b in serialized if b.placement and b.placement.bookcase_id == bookcase_id]
    if shelf_id is not None:
        serialized = [b for b in serialized if b.placement and b.placement.shelf_id == shelf_id]
    if reading_status:
        serialized = [b for b in serialized if b.reading_status == reading_status]
    if genre:
        serialized = [b for b in serialized if (b.genre or "").lower() == genre.lower()]
    if language:
        serialized = [b for b in serialized if (b.language or "").lower() == language.lower()]
    if tag_id is not None:
        serialized = [b for b in serialized if any(t.id == tag_id for t in b.tags)]
    if enrichment == "enriched":
        serialized = [b for b in serialized if b.enrichment_status == "enriched"]
    elif enrichment in ("pending", "missing_metadata"):
        serialized = [b for b in serialized if b.enrichment_status == "pending"]
    elif enrichment == "not_found":
        serialized = [b for b in serialized if b.enrichment_status == "not_found"]

    # Sorting
    reverse = sort_dir == "desc"
    if sort_by == "title":
        serialized.sort(key=lambda b: b.title.lower(), reverse=reverse)
    elif sort_by == "author":
        serialized.sort(
            key=lambda b: (b.authors[0].lower() if b.authors else "zzz", b.title.lower()),
            reverse=reverse,
        )
    elif sort_by == "year":
        serialized.sort(key=lambda b: (b.published_year is None, b.published_year or 0), reverse=reverse)
    elif sort_by == "pages":
        serialized.sort(key=lambda b: (b.page_count is None, b.page_count or 0), reverse=reverse)
    elif sort_by == "created_at":
        serialized.sort(key=lambda b: b.created_at, reverse=reverse)
    else:  # location
        serialized.sort(
            key=lambda b: (
                0 if b.placement else 1,
                b.placement.bookcase_id if b.placement else 999999,
                b.placement.shelf_id if b.placement else 999999,
                b.placement.position_index if b.placement else 999999,
                b.title.lower(),
            ),
            reverse=reverse,
        )

    return serialized


@router.post("/books", response_model=BookRead, status_code=status.HTTP_201_CREATED)
def create_book(payload: BookCreate, db: Session = Depends(get_db)) -> BookRead:
    shelf: Optional[Shelf] = None
    if payload.shelf_id is not None:
        shelf = db.get(Shelf, payload.shelf_id)
        if not shelf:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balda no encontrada")

    width_mm = payload.width_mm
    dimensions_source = payload.dimensions_source
    if width_mm is None and payload.page_count:
        width_mm = estimate_thickness_from_pages(payload.page_count)
        dimensions_source = dimensions_source or "estimated"
    elif (payload.width_mm is not None or payload.height_mm is not None) and not dimensions_source:
        dimensions_source = "manual"

    book = Book(
        title=payload.title.strip(),
        subtitle=payload.subtitle.strip() if payload.subtitle else None,
        authors_json=json.dumps([a.strip() for a in payload.authors if a.strip()], ensure_ascii=False),
        publisher=payload.publisher.strip() if payload.publisher else None,
        published_year=payload.published_year,
        language=payload.language.strip().lower() if payload.language else None,
        isbn_10=payload.isbn_10.strip() if payload.isbn_10 else None,
        isbn_13=payload.isbn_13.strip() if payload.isbn_13 else None,
        page_count=payload.page_count,
        width_mm=width_mm,
        height_mm=payload.height_mm,
        dimensions_source=dimensions_source,
        cover_url=payload.cover_url,
        synopsis=payload.synopsis,
        genre=payload.genre.strip() if payload.genre else None,
        subgenre=payload.subgenre.strip() if payload.subgenre else None,
        series_name=payload.series_name.strip() if payload.series_name else None,
        series_index=payload.series_index,
        reading_status=payload.reading_status,
    )
    db.add(book)
    db.flush()

    if shelf is not None:
        existing_count = len(
            db.scalars(select(BookPlacement).where(BookPlacement.shelf_id == shelf.id)).all()
        )
        db.add(
            BookPlacement(
                book_id=book.id,
                shelf_id=shelf.id,
                position_index=existing_count,
                orientation=payload.orientation,
                row_depth=1,
            )
        )

    db.commit()
    return serialize_book(_get_book_or_404(db, book.id))


@router.get("/books/{book_id}", response_model=BookRead)
def get_book(book_id: int, db: Session = Depends(get_db)) -> BookRead:
    return serialize_book(_get_book_or_404(db, book_id))


@router.patch("/books/{book_id}", response_model=BookRead)
def update_book(book_id: int, payload: BookUpdate, db: Session = Depends(get_db)) -> BookRead:
    book = _get_book_or_404(db, book_id)
    data = payload.model_dump(exclude_unset=True)

    new_shelf_id = data.pop("shelf_id", "__unset__")
    new_orientation = data.pop("orientation", None)

    if "authors" in data and data["authors"] is not None:
        book.authors_json = json.dumps(
            [a.strip() for a in data.pop("authors") if a.strip()], ensure_ascii=False
        )
    elif "authors" in data:
        data.pop("authors")

    dims_edited = False
    for field, value in data.items():
        if isinstance(value, str):
            value = value.strip()
            if field == "language":
                value = value.lower() or None
            elif field != "title":
                value = value or None
        if field in ("width_mm", "height_mm") and value is not None:
            dims_edited = True
        setattr(book, field, value)

    if dims_edited:
        book.dimensions_source = "manual"
    elif book.width_mm is None and book.page_count:
        book.width_mm = estimate_thickness_from_pages(book.page_count)
        if not book.dimensions_source:
            book.dimensions_source = "estimated"

    # If user edited identifying info on a previously not_found book, allow re-enrichment
    if any(k in data for k in ("title", "isbn_10", "isbn_13")) or "authors" in payload.model_fields_set:
        extra = _load_extra_attributes(book)
        if extra.get("enrichment_status") == "not_found":
            _set_extra_attributes(book, {"enrichment_status": "pending"})

    # Handle shelf placement changes
    if new_shelf_id != "__unset__":
        if new_shelf_id is None:
            if book.placement is not None:
                old_shelf_id = book.placement.shelf_id
                db.delete(book.placement)
                db.flush()
                _renormalize_shelf_positions(db, old_shelf_id)
        else:
            target_shelf = db.get(Shelf, new_shelf_id)
            if not target_shelf:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Balda de destino no encontrada"
                )
            if book.placement is None:
                next_pos = len(
                    db.scalars(
                        select(BookPlacement).where(BookPlacement.shelf_id == target_shelf.id)
                    ).all()
                )
                db.add(
                    BookPlacement(
                        book_id=book.id,
                        shelf_id=target_shelf.id,
                        position_index=next_pos,
                        orientation=new_orientation or "vertical",
                        row_depth=1,
                    )
                )
            elif book.placement.shelf_id != target_shelf.id:
                old_shelf_id = book.placement.shelf_id
                next_pos = len(
                    db.scalars(
                        select(BookPlacement).where(BookPlacement.shelf_id == target_shelf.id)
                    ).all()
                )
                book.placement.shelf_id = target_shelf.id
                book.placement.position_index = next_pos
                if new_orientation:
                    book.placement.orientation = new_orientation
                db.flush()
                _renormalize_shelf_positions(db, old_shelf_id)
            elif new_orientation:
                book.placement.orientation = new_orientation
    elif new_orientation and book.placement is not None:
        book.placement.orientation = new_orientation

    db.commit()
    return serialize_book(_get_book_or_404(db, book_id))


@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: int, db: Session = Depends(get_db)) -> None:
    book = _get_book_or_404(db, book_id)
    old_shelf_id = book.placement.shelf_id if book.placement else None
    db.delete(book)
    db.flush()
    if old_shelf_id is not None:
        _renormalize_shelf_positions(db, old_shelf_id)
    db.commit()


@router.post("/books/{book_id}/enrich", response_model=EnrichBookResponse)
async def enrich_single_book(
    book_id: int,
    payload: EnrichBookRequest = EnrichBookRequest(),
    db: Session = Depends(get_db),
) -> EnrichBookResponse:
    book = _get_book_or_404(db, book_id)
    candidate = await fetch_book_enrichment(
        title=book.title,
        authors=_load_authors(book),
        language=book.language,
        isbn_13=book.isbn_13,
        isbn_10=book.isbn_10,
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    if not candidate:
        _set_extra_attributes(
            book, {"enrichment_status": "not_found", "enriched_at": now_iso}
        )
        db.commit()
        return EnrichBookResponse(
            book=serialize_book(_get_book_or_404(db, book_id)),
            matched=False,
            source=None,
            updated_fields=[],
        )

    updated_fields = apply_enrichment_to_book(book, candidate, overwrite=payload.overwrite)
    _set_extra_attributes(
        book,
        {
            "enrichment_status": "enriched",
            "enrichment_source": candidate.source,
            "enriched_at": now_iso,
        },
    )
    db.commit()
    return EnrichBookResponse(
        book=serialize_book(_get_book_or_404(db, book_id)),
        matched=True,
        source=candidate.source,
        updated_fields=updated_fields,
    )


@router.post("/books/enrich-batch", response_model=BatchEnrichResponse)
async def enrich_books_batch(
    payload: BatchEnrichRequest = BatchEnrichRequest(),
    db: Session = Depends(get_db),
) -> BatchEnrichResponse:
    stmt = _book_query()
    if payload.book_ids:
        stmt = stmt.where(Book.id.in_(payload.book_ids))
    books = db.scalars(stmt).all()

    targets: list[Book] = []
    skipped = 0
    for b in books:
        if payload.only_missing and not payload.overwrite and _get_enrichment_status(b) != "pending":
            skipped += 1
            continue
        targets.append(b)

    if not targets:
        return BatchEnrichResponse(
            processed=0, enriched=0, not_found=0, skipped=skipped, errors=0
        )

    semaphore = asyncio.Semaphore(4)

    async def fetch_one(book_item: Book):
        async with semaphore:
            try:
                cand = await fetch_book_enrichment(
                    title=book_item.title,
                    authors=_load_authors(book_item),
                    language=book_item.language,
                    isbn_13=book_item.isbn_13,
                    isbn_10=book_item.isbn_10,
                )
                return book_item.id, cand, None
            except Exception as exc:
                return book_item.id, None, exc

    results = await asyncio.gather(*(fetch_one(b) for b in targets))
    book_by_id = {b.id: b for b in targets}
    now_iso = datetime.now(timezone.utc).isoformat()

    enriched = 0
    not_found = 0
    errors = 0

    for bid, cand, err in results:
        book_obj = book_by_id[bid]
        if err is not None:
            errors += 1
            continue
        if cand is None:
            _set_extra_attributes(
                book_obj, {"enrichment_status": "not_found", "enriched_at": now_iso}
            )
            not_found += 1
            continue
        apply_enrichment_to_book(book_obj, cand, overwrite=payload.overwrite)
        _set_extra_attributes(
            book_obj,
            {
                "enrichment_status": "enriched",
                "enrichment_source": cand.source,
                "enriched_at": now_iso,
            },
        )
        enriched += 1

    db.commit()
    return BatchEnrichResponse(
        processed=len(targets),
        enriched=enriched,
        not_found=not_found,
        skipped=skipped,
        errors=errors,
    )
