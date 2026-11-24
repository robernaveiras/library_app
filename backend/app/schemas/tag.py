from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class TagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=500)
    color_hex: str = Field("#92400e", pattern=r"^#[0-9a-fA-F]{6}$")
    ai_rule_prompt: Optional[str] = Field(None, max_length=1000)


class TagUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=500)
    color_hex: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    ai_rule_prompt: Optional[str] = Field(None, max_length=1000)


class TagRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    color_hex: str
    ai_rule_prompt: Optional[str] = None
    book_count: int = 0
    created_at: datetime


class TagAssignRequest(BaseModel):
    add_book_ids: list[int] = Field(default_factory=list)
    remove_book_ids: list[int] = Field(default_factory=list)
    source: Literal["manual", "ai_confirmed"] = "manual"


class BookSetTagsRequest(BaseModel):
    tag_ids: list[int] = Field(default_factory=list)


class TagEvaluationRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    rule_override: Optional[str] = Field(None, max_length=1000)
    auto_apply: bool = False
    min_confidence: float = Field(0.7, ge=0.0, le=1.0)


class TagMatchProposal(BaseModel):
    book_id: int
    title: str
    authors: list[str] = Field(default_factory=list)
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: Optional[str] = None
    already_assigned: bool = False


class TagEvaluationResponse(BaseModel):
    tag_id: int
    tag_name: str
    rule_used: str
    ai_provider: str
    ai_model: str
    evaluated_books: int
    proposals: list[TagMatchProposal] = Field(default_factory=list)
    applied_count: int = 0


class AICategorizeRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    book_ids: Optional[list[int]] = None
    only_missing: bool = True
    overwrite: bool = False


class AICategorizeResponse(BaseModel):
    ai_provider: str
    ai_model: str
    processed: int
    updated: int
    skipped: int
    errors: int
    genres_summary: dict[str, int] = Field(default_factory=dict)
