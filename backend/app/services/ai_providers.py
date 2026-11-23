import base64
import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from app.config import settings
from app.schemas.scan import DetectedBookCandidate


SHELF_SCAN_SYSTEM_PROMPT = """Eres un experto bibliotecario y analizador visual de estanterías de libros.
Tu tarea es examinar la foto de UNA balda de libros y extraer todos los libros visibles en orden estricto de IZQUIERDA a DERECHA (y de arriba a abajo si hay libros apilados en horizontal).

Reglas obligatorias:
1. Devuelve ÚNICAMENTE un objeto JSON válido con la clave "books" (una lista de objetos). No incluyas explicaciones ni texto fuera del JSON.
2. No inventes libros que no estén presentes en la foto. Si un lomo es ilegible o está en blanco, inclúyelo igualmente con title="Libro sin identificar" y confidence baja (ej. 0.2), indicando en "notes" por qué no se lee.
3. No incluyas información sobre el color de los libros.
4. Para cada libro devuelve exactamente estos campos:
   - "title": string (título leído en el lomo, capitalización normal)
   - "authors": lista de strings (autor o autores visibles o claramente reconocibles por el título/editorial; [] si no se sabe)
   - "publisher": string o null (editorial si es visible en el lomo o logo)
   - "language": string o null (código ISO de 2 letras: "es", "en", "fr", "ca", etc.)
   - "orientation": "vertical" o "horizontal"
   - "confidence": número entre 0.0 y 1.0 (>=0.8 texto nítido, 0.5-0.79 parcialmente legible, <0.5 dudoso o ilegible)
   - "notes": string corto o null (ej. "lomo parcialmente tapado", "texto borroso", "sin autor visible")
   - "bbox": [x_min, y_min, x_max, y_max] con coordenadas normalizadas entre 0.0 y 1.0 respecto al ancho y alto total de la imagen (x_min < x_max, y_min < y_max).
"""


class AIProviderError(Exception):
    """Raised when an AI provider is misconfigured or fails to process a request."""


@dataclass
class ScanAnalysisResult:
    provider: str
    model: str
    candidates: list[DetectedBookCandidate]
    raw_text: str


def _extract_json_payload(raw_text: str) -> Any:
    text = raw_text.strip()
    # Strip markdown code fences if present
    fence_match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try locating the first JSON object or array in the response
        start_obj = text.find("{")
        start_arr = text.find("[")
        starts = [s for s in (start_obj, start_arr) if s != -1]
        if not starts:
            raise AIProviderError("La IA no devolvió un JSON válido.")
        start = min(starts)
        end = max(text.rfind("}"), text.rfind("]"))
        if end <= start:
            raise AIProviderError("La respuesta JSON de la IA está incompleta.")
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise AIProviderError(f"No se pudo interpretar el JSON devuelto por la IA: {exc}") from exc


def _normalize_bbox(raw_bbox: Any) -> Optional[list[float]]:
    if not isinstance(raw_bbox, (list, tuple)) or len(raw_bbox) != 4:
        return None
    try:
        vals = [float(v) for v in raw_bbox]
    except (TypeError, ValueError):
        return None

    # Some vision models output 0..1000 normalized coordinates even when asked for 0..1
    if max(vals) > 1.5:
        vals = [v / 1000.0 for v in vals]

    x_min, y_min, x_max, y_max = [max(0.0, min(1.0, v)) for v in vals]
    if x_max <= x_min or y_max <= y_min:
        return None
    return [round(x_min, 4), round(y_min, 4), round(x_max, 4), round(y_max, 4)]


def parse_detected_books(raw_text: str) -> list[DetectedBookCandidate]:
    payload = _extract_json_payload(raw_text)
    if isinstance(payload, dict):
        items = payload.get("books")
        if items is None:
            # Accept single list under another common key if needed
            for key in ("libros", "items", "detected_books", "results"):
                if isinstance(payload.get(key), list):
                    items = payload[key]
                    break
    elif isinstance(payload, list):
        items = payload
    else:
        items = None

    if not isinstance(items, list):
        raise AIProviderError("La respuesta JSON de la IA no contiene una lista de libros ('books').")

    candidates: list[DetectedBookCandidate] = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip() or "Libro sin identificar"
        raw_authors = item.get("authors")
        if isinstance(raw_authors, str):
            authors = [a.strip() for a in raw_authors.split(",") if a.strip()]
        elif isinstance(raw_authors, list):
            authors = [str(a).strip() for a in raw_authors if str(a).strip()]
        else:
            authors = []

        orientation = str(item.get("orientation") or "vertical").strip().lower()
        if orientation not in ("vertical", "horizontal"):
            orientation = "vertical"

        try:
            confidence = float(item.get("confidence", 0.7))
        except (TypeError, ValueError):
            confidence = 0.7
        confidence = round(max(0.0, min(1.0, confidence)), 2)

        publisher = item.get("publisher")
        publisher = str(publisher).strip()[:200] if publisher else None

        language = item.get("language")
        language = str(language).strip().lower()[:20] if language else None

        notes = item.get("notes")
        notes = str(notes).strip()[:300] if notes else None

        candidates.append(
            DetectedBookCandidate(
                position_index=idx,
                title=title[:300],
                authors=authors,
                publisher=publisher,
                language=language,
                orientation=orientation,  # type: ignore[arg-type]
                confidence=confidence,
                notes=notes,
                bbox=_normalize_bbox(item.get("bbox")),
            )
        )
    return candidates


class AIProvider(ABC):
    provider_id: str
    model: str

    @abstractmethod
    async def analyze_shelf_image(
        self,
        image_bytes: bytes,
        shelf_label: str,
        shelf_width_cm: float,
        shelf_height_cm: float,
        mime_type: str = "image/jpeg",
    ) -> ScanAnalysisResult:
        raise NotImplementedError

    @abstractmethod
    async def complete_json(self, system_prompt: str, user_prompt: str) -> Any:
        raise NotImplementedError


def _build_shelf_user_prompt(shelf_label: str, shelf_width_cm: float, shelf_height_cm: float) -> str:
    return (
        f"Analiza esta foto de la balda '{shelf_label}' "
        f"(medidas físicas aproximadas: {shelf_width_cm:.1f} cm de ancho × {shelf_height_cm:.1f} cm de alto). "
        'Devuelve el JSON con el formato {"books": [...]} siguiendo todas las reglas.'
    )


class GeminiProvider(AIProvider):
    provider_id = "gemini"

    def __init__(self, api_key: str, model: str):
        if not api_key.strip():
            raise AIProviderError("GEMINI_API_KEY no está configurada en el archivo .env.")
        self.api_key = api_key.strip()
        self.model = model.strip()

    async def analyze_shelf_image(
        self,
        image_bytes: bytes,
        shelf_label: str,
        shelf_width_cm: float,
        shelf_height_cm: float,
        mime_type: str = "image/jpeg",
    ) -> ScanAnalysisResult:
        b64_image = base64.b64encode(image_bytes).decode("ascii")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        body = {
            "systemInstruction": {"parts": [{"text": SHELF_SCAN_SYSTEM_PROMPT}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": _build_shelf_user_prompt(
                                shelf_label, shelf_width_cm, shelf_height_cm
                            )
                        },
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": b64_image,
                            }
                        },
                    ],
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post(url, params={"key": self.api_key}, json=body)
            except httpx.HTTPError as exc:
                raise AIProviderError(f"Error de conexión con Gemini: {exc}") from exc

        if resp.status_code >= 400:
            raise AIProviderError(f"Gemini devolvió error {resp.status_code}: {resp.text[:400]}")

        data = resp.json()
        try:
            parts = data["candidates"][0]["content"]["parts"]
            raw_text = "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as exc:
            raise AIProviderError(f"Respuesta inesperada de Gemini: {str(data)[:300]}") from exc

        candidates = parse_detected_books(raw_text)
        return ScanAnalysisResult(
            provider=self.provider_id,
            model=self.model,
            candidates=candidates,
            raw_text=raw_text,
        )

    async def complete_json(self, system_prompt: str, user_prompt: str) -> Any:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        body = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post(url, params={"key": self.api_key}, json=body)
            except httpx.HTTPError as exc:
                raise AIProviderError(f"Error de conexión con Gemini: {exc}") from exc

        if resp.status_code >= 400:
            raise AIProviderError(f"Gemini devolvió error {resp.status_code}: {resp.text[:400]}")

        data = resp.json()
        try:
            parts = data["candidates"][0]["content"]["parts"]
            raw_text = "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as exc:
            raise AIProviderError(f"Respuesta inesperada de Gemini: {str(data)[:300]}") from exc

        return _extract_json_payload(raw_text)


class StrataOpenAIProvider(AIProvider):
    provider_id = "strata"

    def __init__(self, base_url: str, api_key: str, model: str):
        if not base_url.strip() or not api_key.strip():
            raise AIProviderError(
                "STRATA_BASE_URL y STRATA_API_KEY deben estar configurados en el archivo .env."
            )
        self.base_url = base_url.strip().rstrip("/")
        self.api_key = api_key.strip()
        self.model = model.strip()

    async def _post_chat_completions(self, payload: dict[str, Any]) -> str:
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(url, headers=headers, json=payload)
            except httpx.HTTPError as exc:
                raise AIProviderError(f"Error de conexión con Strata ({self.base_url}): {exc}") from exc

            # Graceful fallback if the OpenAI-compatible endpoint doesn't support response_format
            if resp.status_code in (400, 422) and "response_format" in payload:
                fallback_payload = {k: v for k, v in payload.items() if k != "response_format"}
                try:
                    resp = await client.post(url, headers=headers, json=fallback_payload)
                except httpx.HTTPError as exc:
                    raise AIProviderError(
                        f"Error de conexión con Strata ({self.base_url}): {exc}"
                    ) from exc

        if resp.status_code >= 400:
            raise AIProviderError(f"Strata devolvió error {resp.status_code}: {resp.text[:400]}")

        data = resp.json()
        try:
            content = data["choices"][0]["message"]["content"]
            if isinstance(content, list):
                return "".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            return str(content)
        except (KeyError, IndexError, TypeError) as exc:
            raise AIProviderError(f"Respuesta inesperada de Strata: {str(data)[:300]}") from exc

    async def analyze_shelf_image(
        self,
        image_bytes: bytes,
        shelf_label: str,
        shelf_width_cm: float,
        shelf_height_cm: float,
        mime_type: str = "image/jpeg",
    ) -> ScanAnalysisResult:
        b64_image = base64.b64encode(image_bytes).decode("ascii")
        data_url = f"data:{mime_type};base64,{b64_image}"
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SHELF_SCAN_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": _build_shelf_user_prompt(
                                shelf_label, shelf_width_cm, shelf_height_cm
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                },
            ],
        }
        raw_text = await self._post_chat_completions(payload)
        candidates = parse_detected_books(raw_text)
        return ScanAnalysisResult(
            provider=self.provider_id,
            model=self.model,
            candidates=candidates,
            raw_text=raw_text,
        )

    async def complete_json(self, system_prompt: str, user_prompt: str) -> Any:
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        raw_text = await self._post_chat_completions(payload)
        return _extract_json_payload(raw_text)


def get_ai_provider(
    provider_id: Optional[str] = None, model_override: Optional[str] = None
) -> AIProvider:
    chosen = (provider_id or settings.default_ai_provider or "gemini").strip().lower()
    if chosen == "gemini":
        return GeminiProvider(
            api_key=settings.gemini_api_key,
            model=model_override or settings.gemini_model,
        )
    if chosen == "strata":
        return StrataOpenAIProvider(
            base_url=settings.strata_base_url,
            api_key=settings.strata_api_key,
            model=model_override or settings.strata_model,
        )
    raise AIProviderError(f"Proveedor de IA desconocido: '{chosen}'. Usa 'gemini' o 'strata'.")
