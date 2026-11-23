from fastapi import APIRouter

from app.config import settings
from app.schemas.settings import AIProviderStatus, ConfigStatus

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config/status", response_model=ConfigStatus)
def get_config_status() -> ConfigStatus:
    providers = [
        AIProviderStatus(
            id="gemini",
            name="Google Gemini",
            configured=bool(settings.gemini_api_key.strip()),
            model=settings.gemini_model,
        ),
        AIProviderStatus(
            id="strata",
            name="Strata (OpenAI-compatible)",
            configured=bool(settings.strata_base_url.strip() and settings.strata_api_key.strip()),
            model=settings.strata_model,
        ),
    ]
    return ConfigStatus(
        default_provider=settings.default_ai_provider,
        providers=providers,
        google_books_api_key_configured=bool(settings.google_books_api_key.strip()),
    )
