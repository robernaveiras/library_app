from typing import Optional

from pydantic import BaseModel, Field


class AIProviderStatus(BaseModel):
    id: str
    name: str
    configured: bool
    model: str
    suggested_models: list[str] = Field(default_factory=list)


class ConfigStatus(BaseModel):
    default_provider: str
    providers: list[AIProviderStatus]
    google_books_api_key_configured: bool


class ProviderModelOption(BaseModel):
    id: str
    display_name: Optional[str] = None


class ProviderModelsResponse(BaseModel):
    provider: str
    ok: bool
    models: list[ProviderModelOption] = Field(default_factory=list)
    error: Optional[str] = None
