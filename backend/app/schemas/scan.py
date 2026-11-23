from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class DetectedBookCandidate(BaseModel):
    position_index: int = Field(..., ge=0)
    title: str = Field(..., min_length=1, max_length=300)
    authors: list[str] = Field(default_factory=list)
    publisher: Optional[str] = Field(None, max_length=200)
    language: Optional[str] = Field(None, max_length=20)
    orientation: Literal["vertical", "horizontal"] = "vertical"
    confidence: float = Field(0.7, ge=0.0, le=1.0)
    notes: Optional[str] = Field(None, max_length=300)
    # Normalized [x_min, y_min, x_max, y_max] in 0..1 coordinates
    bbox: Optional[list[float]] = None


class ShelfScanRead(BaseModel):
    id: int
    shelf_id: int
    image_url: str
    ai_provider: str
    ai_model: str
    status: str
    candidates: list[DetectedBookCandidate] = Field(default_factory=list)
    created_at: datetime


class ShelfScanSummary(BaseModel):
    id: int
    shelf_id: int
    image_url: str
    ai_provider: str
    ai_model: str
    status: str
    candidate_count: int
    created_at: datetime


class ConfirmScanBookItem(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    subtitle: Optional[str] = Field(None, max_length=300)
    authors: list[str] = Field(default_factory=list)
    publisher: Optional[str] = Field(None, max_length=200)
    published_year: Optional[int] = Field(None, ge=1000, le=2100)
    language: Optional[str] = Field(None, max_length=20)
    isbn_10: Optional[str] = Field(None, max_length=20)
    isbn_13: Optional[str] = Field(None, max_length=20)
    page_count: Optional[int] = Field(None, ge=1, le=20000)
    width_mm: Optional[float] = Field(None, gt=0, le=500)
    height_mm: Optional[float] = Field(None, gt=0, le=1000)
    dimensions_source: Optional[str] = None
    cover_url: Optional[str] = Field(None, max_length=500)
    synopsis: Optional[str] = None
    reading_status: Literal["unknown", "unread", "reading", "read"] = "unknown"
    orientation: Literal["vertical", "horizontal"] = "vertical"
    row_depth: int = Field(1, ge=1, le=3)
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    bbox: Optional[list[float]] = None


class ConfirmScanRequest(BaseModel):
    replace_existing: bool = True
    books: list[ConfirmScanBookItem] = Field(default_factory=list)


class ShelfBookRead(BaseModel):
    book_id: int
    placement_id: int
    shelf_id: int
    position_index: int
    title: str
    subtitle: Optional[str] = None
    authors: list[str] = Field(default_factory=list)
    publisher: Optional[str] = None
    published_year: Optional[int] = None
    language: Optional[str] = None
    isbn_10: Optional[str] = None
    isbn_13: Optional[str] = None
    page_count: Optional[int] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    dimensions_source: Optional[str] = None
    cover_url: Optional[str] = None
    reading_status: str = "unknown"
    orientation: str = "vertical"
    confidence: Optional[float] = None


class ConfirmScanResponse(BaseModel):
    scan_id: int
    shelf_id: int
    confirmed_count: int
    books: list[ShelfBookRead]


class IsbnLookupResult(BaseModel):
    isbn: str
    title: str
    subtitle: Optional[str] = None
    authors: list[str] = Field(default_factory=list)
    publisher: Optional[str] = None
    published_year: Optional[int] = None
    language: Optional[str] = None
    isbn_10: Optional[str] = None
    isbn_13: Optional[str] = None
    page_count: Optional[int] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    dimensions_source: Optional[str] = None
    cover_url: Optional[str] = None
    synopsis: Optional[str] = None
    source: str
