from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


ReadingStatus = Literal["unknown", "unread", "reading", "read"]
BookOrientation = Literal["vertical", "horizontal"]
EnrichmentStatus = Literal["enriched", "pending", "not_found"]


class BookTagBrief(BaseModel):
    id: int
    name: str
    color_hex: str
    source: str


class BookPlacementInfo(BaseModel):
    placement_id: int
    bookcase_id: int
    bookcase_name: str
    shelf_id: int
    shelf_label: str
    position_index: int
    orientation: BookOrientation
    row_depth: int
    confidence: Optional[float] = None


class BookRead(BaseModel):
    id: int
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
    genre: Optional[str] = None
    subgenre: Optional[str] = None
    series_name: Optional[str] = None
    series_index: Optional[float] = None
    reading_status: ReadingStatus = "unknown"
    extra_attributes: dict[str, object] = Field(default_factory=dict)
    placement: Optional[BookPlacementInfo] = None
    tags: list[BookTagBrief] = Field(default_factory=list)
    enrichment_status: EnrichmentStatus = "pending"
    needs_enrichment: bool = False
    created_at: datetime
    updated_at: datetime


class BookCreate(BaseModel):
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
    genre: Optional[str] = Field(None, max_length=100)
    subgenre: Optional[str] = Field(None, max_length=100)
    series_name: Optional[str] = Field(None, max_length=200)
    series_index: Optional[float] = Field(None, ge=0, le=1000)
    reading_status: ReadingStatus = "unknown"
    shelf_id: Optional[int] = None
    orientation: BookOrientation = "vertical"


class BookUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    subtitle: Optional[str] = Field(None, max_length=300)
    authors: Optional[list[str]] = None
    publisher: Optional[str] = Field(None, max_length=200)
    published_year: Optional[int] = Field(None, ge=1000, le=2100)
    language: Optional[str] = Field(None, max_length=20)
    isbn_10: Optional[str] = Field(None, max_length=20)
    isbn_13: Optional[str] = Field(None, max_length=20)
    page_count: Optional[int] = Field(None, ge=1, le=20000)
    width_mm: Optional[float] = Field(None, gt=0, le=500)
    height_mm: Optional[float] = Field(None, gt=0, le=1000)
    cover_url: Optional[str] = Field(None, max_length=500)
    synopsis: Optional[str] = None
    genre: Optional[str] = Field(None, max_length=100)
    subgenre: Optional[str] = Field(None, max_length=100)
    series_name: Optional[str] = Field(None, max_length=200)
    series_index: Optional[float] = Field(None, ge=0, le=1000)
    reading_status: Optional[ReadingStatus] = None
    # Placement adjustment (pass shelf_id to move to another shelf; omit to keep unchanged)
    shelf_id: Optional[int] = None
    orientation: Optional[BookOrientation] = None


class EnrichBookRequest(BaseModel):
    overwrite: bool = False


class EnrichBookResponse(BaseModel):
    book: BookRead
    matched: bool
    source: Optional[str] = None
    updated_fields: list[str] = Field(default_factory=list)


class BatchEnrichRequest(BaseModel):
    book_ids: Optional[list[int]] = None
    only_missing: bool = True
    overwrite: bool = False


class BatchEnrichResponse(BaseModel):
    processed: int
    enriched: int
    not_found: int
    skipped: int
    errors: int


class InventoryStats(BaseModel):
    total_books: int
    placed_books: int
    enriched_books: int
    needs_enrichment_count: int
    not_found_enrichment_count: int = 0
    unread_count: int
    reading_count: int
    read_count: int
    estimated_linear_meters: float
    languages: list[str] = Field(default_factory=list)
    genres: list[str] = Field(default_factory=list)
