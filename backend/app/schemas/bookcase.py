from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ShelfBase(BaseModel):
    label: str = Field(..., min_length=1, max_length=80)
    width_cm: float = Field(..., gt=0, le=1000, description="Ancho útil de la balda en cm")
    height_cm: float = Field(..., gt=0, le=500, description="Altura libre de la balda en cm")
    depth_cm: Optional[float] = Field(None, gt=0, le=300, description="Profundidad de la balda en cm (opcional)")
    notes: Optional[str] = Field(None, max_length=500)


class ShelfCreate(ShelfBase):
    position_index: Optional[int] = Field(None, ge=0)


class ShelfUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=80)
    position_index: Optional[int] = Field(None, ge=0)
    width_cm: Optional[float] = Field(None, gt=0, le=1000)
    height_cm: Optional[float] = Field(None, gt=0, le=500)
    depth_cm: Optional[float] = Field(None, gt=0, le=300)
    notes: Optional[str] = Field(None, max_length=500)


class ShelfRead(ShelfBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bookcase_id: int
    position_index: int
    book_count: int = 0
    used_width_cm: float = 0.0
    created_at: datetime
    updated_at: datetime


class ShelfReorderRequest(BaseModel):
    shelf_ids: list[int] = Field(..., min_length=1)


class QuickShelfConfig(BaseModel):
    count: int = Field(..., ge=1, le=30)
    width_cm: float = Field(..., gt=0, le=1000)
    height_cm: float = Field(..., gt=0, le=500)
    depth_cm: Optional[float] = Field(None, gt=0, le=300)


class BookcaseBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    location: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=1000)


class BookcaseCreate(BookcaseBase):
    initial_shelves: Optional[QuickShelfConfig] = None


class BookcaseUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    location: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=1000)


class BookcaseRead(BookcaseBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shelves: list[ShelfRead] = Field(default_factory=list)
    total_books: int = 0
    total_width_cm: float = 0.0
    created_at: datetime
    updated_at: datetime
