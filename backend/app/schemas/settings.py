from pydantic import BaseModel


class AIProviderStatus(BaseModel):
    id: str
    name: str
    configured: bool
    model: str


class ConfigStatus(BaseModel):
    default_provider: str
    providers: list[AIProviderStatus]
    google_books_api_key_configured: bool
