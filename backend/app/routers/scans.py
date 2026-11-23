import json
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import get_db
from app.models import Book, BookPlacement, Shelf, ShelfScan
from app.schemas.scan import (
    ConfirmScanRequest,
    ConfirmScanResponse,
    DetectedBookCandidate,
    IsbnLookupResult,
    ShelfBookRead,
    ShelfScanRead,
    ShelfScanSummary,
)
from app.services.ai_providers import AIProviderError, get_ai_provider
from app.services.image_utils import estimate_dimensions_from_bbox, process_and_save_scan_image
from app.services.isbn_lookup import lookup_isbn

router = APIRouter(prefix="/api", tags=["scans"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


def _parse_stored_candidates(raw_response_json: Optional[str]) -> list[DetectedBookCandidate]:
    if not raw_response_json:
        return []
    try:
        data = json.loads(raw_response_json)
        raw_candidates = data.get("candidates") if isinstance(data, dict) else []
        return [DetectedBookCandidate.model_validate(c) for c in raw_candidates]
    except Exception:
        return []


def _serialize_scan(scan: ShelfScan) -> ShelfScanRead:
    return ShelfScanRead(
        id=scan.id,
        shelf_id=scan.shelf_id,
        image_url=f"/api/scans/{scan.id}/image",
        ai_provider=scan.ai_provider,
        ai_model=scan.ai_model,
        status=scan.status,
        candidates=_parse_stored_candidates(scan.raw_response_json),
        created_at=scan.created_at,
    )


def _serialize_shelf_book(placement: BookPlacement) -> ShelfBookRead:
    book = placement.book
    try:
        authors = json.loads(book.authors_json or "[]")
        if not isinstance(authors, list):
            authors = []
    except json.JSONDecodeError:
        authors = []
    return ShelfBookRead(
        book_id=book.id,
        placement_id=placement.id,
        shelf_id=placement.shelf_id,
        position_index=placement.position_index,
        title=book.title,
        subtitle=book.subtitle,
        authors=authors,
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
        reading_status=book.reading_status,
        orientation=placement.orientation,
        confidence=placement.confidence,
    )


def _get_shelf_or_404(db: Session, shelf_id: int) -> Shelf:
    shelf = db.get(Shelf, shelf_id)
    if not shelf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balda no encontrada")
    return shelf


def _get_scan_or_404(db: Session, scan_id: int) -> ShelfScan:
    scan = db.get(ShelfScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Escaneo no encontrado")
    return scan


@router.post(
    "/shelves/{shelf_id}/scans",
    response_model=ShelfScanRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_shelf_scan(
    shelf_id: int,
    file: UploadFile = File(...),
    provider: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    db: Session = Depends(get_db),
) -> ShelfScanRead:
    shelf = _get_shelf_or_404(db, shelf_id)

    try:
        ai = get_ai_provider(provider_id=provider, model_override=model)
    except AIProviderError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La imagen está vacía.")
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La imagen supera el tamaño máximo permitido (25 MB).",
        )

    filename = f"shelf_{shelf.id}_{uuid4().hex[:12]}.jpg"
    dest_path = settings.scans_dir / filename
    try:
        process_and_save_scan_image(raw_bytes, dest_path)
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo subido no es una imagen válida.",
        ) from exc

    processed_bytes = dest_path.read_bytes()

    scan = ShelfScan(
        shelf_id=shelf.id,
        image_path=str(dest_path),
        ai_provider=ai.provider_id,
        ai_model=ai.model,
        status="pending",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    try:
        result = await ai.analyze_shelf_image(
            image_bytes=processed_bytes,
            shelf_label=shelf.label,
            shelf_width_cm=shelf.width_cm,
            shelf_height_cm=shelf.height_cm,
            mime_type="image/jpeg",
        )
    except AIProviderError as exc:
        scan.status = "error"
        scan.raw_response_json = json.dumps({"error": str(exc), "candidates": []}, ensure_ascii=False)
        db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    scan.raw_response_json = json.dumps(
        {
            "raw_text": result.raw_text,
            "candidates": [c.model_dump() for c in result.candidates],
        },
        ensure_ascii=False,
    )
    scan.status = "reviewed"
    db.commit()
    db.refresh(scan)

    return _serialize_scan(scan)


@router.get("/shelves/{shelf_id}/scans", response_model=list[ShelfScanSummary])
def list_shelf_scans(shelf_id: int, db: Session = Depends(get_db)) -> list[ShelfScanSummary]:
    _get_shelf_or_404(db, shelf_id)
    scans = db.scalars(
        select(ShelfScan)
        .where(ShelfScan.shelf_id == shelf_id)
        .order_by(ShelfScan.created_at.desc(), ShelfScan.id.desc())
        .limit(15)
    ).all()
    return [
        ShelfScanSummary(
            id=s.id,
            shelf_id=s.shelf_id,
            image_url=f"/api/scans/{s.id}/image",
            ai_provider=s.ai_provider,
            ai_model=s.ai_model,
            status=s.status,
            candidate_count=len(_parse_stored_candidates(s.raw_response_json)),
            created_at=s.created_at,
        )
        for s in scans
    ]


@router.get("/scans/{scan_id}", response_model=ShelfScanRead)
def get_scan(scan_id: int, db: Session = Depends(get_db)) -> ShelfScanRead:
    scan = _get_scan_or_404(db, scan_id)
    return _serialize_scan(scan)


@router.get("/scans/{scan_id}/image")
def get_scan_image(scan_id: int, db: Session = Depends(get_db)):
    scan = _get_scan_or_404(db, scan_id)
    img_path = Path(scan.image_path)
    if not img_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imagen del escaneo no encontrada")
    return FileResponse(img_path, media_type="image/jpeg")


@router.delete("/scans/{scan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scan(scan_id: int, db: Session = Depends(get_db)) -> None:
    scan = _get_scan_or_404(db, scan_id)
    img_path = Path(scan.image_path)
    db.delete(scan)
    db.commit()
    if img_path.is_file():
        try:
            img_path.unlink()
        except OSError:
            pass


@router.post("/scans/{scan_id}/confirm", response_model=ConfirmScanResponse)
def confirm_scan(
    scan_id: int, payload: ConfirmScanRequest, db: Session = Depends(get_db)
) -> ConfirmScanResponse:
    scan = _get_scan_or_404(db, scan_id)
    shelf = _get_shelf_or_404(db, scan.shelf_id)

    existing_placements = db.scalars(
        select(BookPlacement)
        .options(selectinload(BookPlacement.book))
        .where(BookPlacement.shelf_id == shelf.id)
        .order_by(BookPlacement.position_index)
    ).all()

    start_index = 0
    if payload.replace_existing:
        # Remove previous books currently placed on this shelf so re-scanning stays clean
        for placement in existing_placements:
            book = placement.book
            db.delete(placement)
            if book is not None:
                db.delete(book)
        db.flush()
    else:
        start_index = len(existing_placements)

    for offset, item in enumerate(payload.books):
        width_mm = item.width_mm
        height_mm = item.height_mm
        dimensions_source = item.dimensions_source

        if (width_mm is None or height_mm is None) and item.bbox:
            est_w, est_h = estimate_dimensions_from_bbox(
                bbox=item.bbox,
                shelf_width_cm=shelf.width_cm,
                shelf_height_cm=shelf.height_cm,
                orientation=item.orientation,
            )
            if width_mm is None and est_w is not None:
                width_mm = est_w
                dimensions_source = dimensions_source or "visual_calibration"
            if height_mm is None and est_h is not None:
                height_mm = est_h
                dimensions_source = dimensions_source or "visual_calibration"

        book = Book(
            title=item.title.strip(),
            subtitle=item.subtitle.strip() if item.subtitle else None,
            authors_json=json.dumps([a.strip() for a in item.authors if a.strip()], ensure_ascii=False),
            publisher=item.publisher.strip() if item.publisher else None,
            published_year=item.published_year,
            language=item.language.strip().lower() if item.language else None,
            isbn_10=item.isbn_10.strip() if item.isbn_10 else None,
            isbn_13=item.isbn_13.strip() if item.isbn_13 else None,
            page_count=item.page_count,
            width_mm=width_mm,
            height_mm=height_mm,
            dimensions_source=dimensions_source,
            cover_url=item.cover_url,
            synopsis=item.synopsis,
            reading_status=item.reading_status,
        )
        db.add(book)
        db.flush()

        placement = BookPlacement(
            book_id=book.id,
            shelf_id=shelf.id,
            position_index=start_index + offset,
            orientation=item.orientation,
            row_depth=item.row_depth,
            confidence=item.confidence,
            bbox_json=json.dumps(item.bbox) if item.bbox else None,
            scan_id=scan.id,
        )
        db.add(placement)

    scan.status = "confirmed"
    db.commit()

    updated_placements = db.scalars(
        select(BookPlacement)
        .options(selectinload(BookPlacement.book))
        .where(BookPlacement.shelf_id == shelf.id)
        .order_by(BookPlacement.position_index)
    ).all()

    return ConfirmScanResponse(
        scan_id=scan.id,
        shelf_id=shelf.id,
        confirmed_count=len(payload.books),
        books=[_serialize_shelf_book(p) for p in updated_placements],
    )


@router.get("/shelves/{shelf_id}/books", response_model=list[ShelfBookRead])
def list_shelf_books(shelf_id: int, db: Session = Depends(get_db)) -> list[ShelfBookRead]:
    _get_shelf_or_404(db, shelf_id)
    placements = db.scalars(
        select(BookPlacement)
        .options(selectinload(BookPlacement.book))
        .where(BookPlacement.shelf_id == shelf_id)
        .order_by(BookPlacement.position_index)
    ).all()
    return [_serialize_shelf_book(p) for p in placements]


@router.get("/isbn/{raw_isbn}", response_model=IsbnLookupResult)
async def get_book_by_isbn(raw_isbn: str) -> IsbnLookupResult:
    try:
        result = await lookup_isbn(raw_isbn)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún libro con el ISBN {raw_isbn}.",
        )
    return result
