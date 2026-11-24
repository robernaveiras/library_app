import httpx
from fastapi import APIRouter, Query

from app.config import settings
from app.schemas.settings import (
    AIProviderStatus,
    ConfigStatus,
    ProviderModelOption,
    ProviderModelsResponse,
)

router = APIRouter(prefix="/api", tags=["system"])

DEFAULT_GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
]


def _dedupe_preserve(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        clean = item.strip()
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config/test-strata")
async def test_strata_connection() -> dict[str, object]:
    """Quick connectivity check against Strata's OpenAI-compatible /models endpoint."""
    base_url = settings.strata_base_url.strip().rstrip("/")
    api_key = settings.strata_api_key.strip()
    if not base_url or not api_key:
        return {
            "ok": False,
            "error": "STRATA_BASE_URL o STRATA_API_KEY no están configurados en .env.",
        }

    url = f"{base_url}/models"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
    except httpx.HTTPError as exc:
        return {
            "ok": False,
            "base_url": base_url,
            "configured_model": settings.strata_model,
            "error": f"{type(exc).__name__}: {exc}".strip(": "),
        }

    if resp.status_code >= 400:
        return {
            "ok": False,
            "base_url": base_url,
            "configured_model": settings.strata_model,
            "status_code": resp.status_code,
            "error": resp.text[:300],
        }

    try:
        data = resp.json()
        models = [m.get("id") for m in (data.get("data") or []) if isinstance(m, dict) and m.get("id")]
    except Exception:
        models = []

    return {
        "ok": True,
        "base_url": base_url,
        "configured_model": settings.strata_model,
        "model_found": settings.strata_model in models if models else None,
        "available_models": models,
    }


@router.get("/config/models", response_model=ProviderModelsResponse)
async def list_provider_models(
    provider: str = Query(..., pattern="^(gemini|strata)$"),
) -> ProviderModelsResponse:
    """Fetch live available models from Gemini or Strata API."""
    if provider == "gemini":
        api_key = settings.gemini_api_key.strip()
        if not api_key:
            return ProviderModelsResponse(
                provider="gemini",
                ok=False,
                models=[ProviderModelOption(id=m) for m in _dedupe_preserve([settings.gemini_model, *DEFAULT_GEMINI_MODELS])],
                error="GEMINI_API_KEY no está configurada en .env.",
            )
        url = "https://generativelanguage.googleapis.com/v1beta/models"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
                resp = await client.get(url, params={"key": api_key, "pageSize": "100"})
        except httpx.HTTPError as exc:
            return ProviderModelsResponse(
                provider="gemini",
                ok=False,
                models=[ProviderModelOption(id=m) for m in _dedupe_preserve([settings.gemini_model, *DEFAULT_GEMINI_MODELS])],
                error=f"{type(exc).__name__}: {exc}".strip(": "),
            )

        if resp.status_code >= 400:
            return ProviderModelsResponse(
                provider="gemini",
                ok=False,
                models=[ProviderModelOption(id=m) for m in _dedupe_preserve([settings.gemini_model, *DEFAULT_GEMINI_MODELS])],
                error=f"Gemini devolvió {resp.status_code}: {resp.text[:250]}",
            )

        data = resp.json()
        options: list[ProviderModelOption] = []
        for m in data.get("models") or []:
            if not isinstance(m, dict):
                continue
            methods = m.get("supportedGenerationMethods") or []
            if "generateContent" not in methods:
                continue
            raw_name = str(m.get("name") or "")
            model_id = raw_name.removeprefix("models/").strip()
            if not model_id or "embedding" in model_id or "imagen" in model_id or "veo" in model_id:
                continue
            options.append(
                ProviderModelOption(
                    id=model_id,
                    display_name=m.get("displayName"),
                )
            )
        # Prefer newer Gemini models first
        options.sort(
            key=lambda o: (
                0 if "2.5" in o.id else 1 if "2.0" in o.id else 2,
                0 if "flash" in o.id else 1 if "pro" in o.id else 2,
                o.id,
            )
        )
        return ProviderModelsResponse(provider="gemini", ok=True, models=options)

    # provider == "strata"
    base_url = settings.strata_base_url.strip().rstrip("/")
    api_key = settings.strata_api_key.strip()
    if not base_url or not api_key:
        return ProviderModelsResponse(
            provider="strata",
            ok=False,
            models=[ProviderModelOption(id=settings.strata_model)] if settings.strata_model else [],
            error="STRATA_BASE_URL o STRATA_API_KEY no están configurados en .env.",
        )

    url = f"{base_url}/models"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
    except httpx.HTTPError as exc:
        return ProviderModelsResponse(
            provider="strata",
            ok=False,
            models=[ProviderModelOption(id=settings.strata_model)] if settings.strata_model else [],
            error=f"{type(exc).__name__}: {exc}".strip(": "),
        )

    if resp.status_code >= 400:
        return ProviderModelsResponse(
            provider="strata",
            ok=False,
            models=[ProviderModelOption(id=settings.strata_model)] if settings.strata_model else [],
            error=f"Strata devolvió {resp.status_code}: {resp.text[:250]}",
        )

    data = resp.json()
    options = [
        ProviderModelOption(id=str(m["id"]).strip())
        for m in (data.get("data") or [])
        if isinstance(m, dict) and m.get("id")
    ]
    return ProviderModelsResponse(provider="strata", ok=True, models=options)


@router.get("/config/status", response_model=ConfigStatus)
def get_config_status() -> ConfigStatus:
    providers = [
        AIProviderStatus(
            id="gemini",
            name="Google Gemini",
            configured=bool(settings.gemini_api_key.strip()),
            model=settings.gemini_model,
            suggested_models=_dedupe_preserve([settings.gemini_model, *DEFAULT_GEMINI_MODELS]),
        ),
        AIProviderStatus(
            id="strata",
            name="Strata (OpenAI-compatible)",
            configured=bool(settings.strata_base_url.strip() and settings.strata_api_key.strip()),
            model=settings.strata_model,
            suggested_models=_dedupe_preserve([settings.strata_model]),
        ),
    ]
    return ConfigStatus(
        default_provider=settings.default_ai_provider,
        providers=providers,
        google_books_api_key_configured=bool(settings.google_books_api_key.strip()),
    )
