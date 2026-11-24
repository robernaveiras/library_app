from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


SortField = Literal[
    "reading_status",
    "tag",
    "genre",
    "subgenre",
    "language",
    "author",
    "series",
    "title",
    "published_year",
    "publisher",
    "height",
    "pages",
    "fiction_vs_nonfiction",
]


class SortRule(BaseModel):
    field: SortField
    direction: Literal["asc", "desc"] = "asc"
    tag_id: Optional[int] = None
    priority_value: Optional[str] = None


class DedicatedSectionRule(BaseModel):
    label: str = Field(..., min_length=1, max_length=100)
    match_type: Literal["reading_status", "tag", "genre", "language"]
    match_value: str = Field(..., min_length=1, max_length=120)
    target_bookcase_id: Optional[int] = None
    target_shelf_id: Optional[int] = None
    placement_order: Literal["first", "last"] = "first"


PackMode = Literal["balanced", "compact", "per_bookcase"]


class OrganizationCriteria(BaseModel):
    name: str = Field("Plan de organización", min_length=1, max_length=150)
    description: Optional[str] = Field(None, max_length=1000)
    dedicated_sections: list[DedicatedSectionRule] = Field(default_factory=list)
    sort_rules: list[SortRule] = Field(default_factory=list)
    pack_mode: PackMode = "balanced"
    bookcase_ids: Optional[list[int]] = None
    only_occupied_shelves: bool = False
    free_space_percent: float = Field(10.0, ge=0.0, le=50.0)
    height_clearance_mm: float = Field(10.0, ge=0.0, le=50.0)
    keep_series_together: bool = True
    keep_author_together: bool = True
    include_unplaced_books: bool = True


class VisualBookSlot(BaseModel):
    book_id: int
    title: str
    authors: list[str] = Field(default_factory=list)
    genre: Optional[str] = None
    series_name: Optional[str] = None
    series_index: Optional[float] = None
    reading_status: str = "unknown"
    width_mm: float
    height_mm: float
    position_index: int
    section_label: str
    section_color: str
    moved: bool = False
    from_location: Optional[str] = None


class VisualShelfLayout(BaseModel):
    shelf_id: int
    bookcase_id: int
    bookcase_name: str
    label: str
    position_index: int
    width_cm: float
    height_cm: float
    used_width_mm: float
    fill_percent: float
    books: list[VisualBookSlot] = Field(default_factory=list)


class VisualBookcaseLayout(BaseModel):
    bookcase_id: int
    name: str
    location: Optional[str] = None
    shelves: list[VisualShelfLayout] = Field(default_factory=list)


class UnplacedBookWarning(BaseModel):
    book_id: int
    title: str
    authors: list[str] = Field(default_factory=list)
    width_mm: float
    height_mm: float
    reason: str


class MoveStepBookItem(BaseModel):
    book_id: int
    title: str
    authors: list[str] = Field(default_factory=list)
    from_label: Optional[str] = None
    to_label: Optional[str] = None
    section_label: str = ""


class MoveStep(BaseModel):
    id: str
    phase: Literal["clear", "place"]
    title: str
    description: str
    shelf_id: Optional[int] = None
    shelf_label: Optional[str] = None
    books: list[MoveStepBookItem] = Field(default_factory=list)
    done: bool = False


class SectionLegendItem(BaseModel):
    label: str
    color_hex: str
    count: int


class OrganizationMetrics(BaseModel):
    total_books: int
    placed_books: int
    unplaced_books: int
    books_moved: int
    books_unchanged: int
    shelves_touched: int
    average_fill_percent: float


class TargetPlacementRecord(BaseModel):
    book_id: int
    shelf_id: int
    position_index: int


class OrganizationPreviewResponse(BaseModel):
    criteria: OrganizationCriteria
    before_bookcases: list[VisualBookcaseLayout]
    after_bookcases: list[VisualBookcaseLayout]
    legend: list[SectionLegendItem] = Field(default_factory=list)
    move_steps: list[MoveStep] = Field(default_factory=list)
    unplaced_books: list[UnplacedBookWarning] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    metrics: OrganizationMetrics
    target_placements: list[TargetPlacementRecord] = Field(default_factory=list)


class AISuggestRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    user_goal: Optional[str] = Field(None, max_length=500)


class AISuggestionScheme(BaseModel):
    name: str
    summary: str
    why_easy_to_find: str
    pros: list[str] = Field(default_factory=list)
    criteria: OrganizationCriteria


class AISuggestResponse(BaseModel):
    ai_provider: str
    ai_model: str
    suggestions: list[AISuggestionScheme] = Field(default_factory=list)


class PlanCreateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    description: Optional[str] = Field(None, max_length=1000)
    criteria: OrganizationCriteria


class PlanStepProgressUpdate(BaseModel):
    step_id: str
    done: bool


class PlanSummaryRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    status: str
    total_steps: int
    completed_steps: int
    books_moved: int
    created_at: datetime
    updated_at: datetime


class PlanDetailRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    status: str
    criteria: OrganizationCriteria
    preview: OrganizationPreviewResponse
    created_at: datetime
    updated_at: datetime
