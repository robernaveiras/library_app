import base64
import json
import logging
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from app.config import settings
from app.schemas.scan import DetectedBookCandidate
from app.services.image_utils import resize_image_bytes

logger = logging.getLogger(__name__)


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

    def __init__(self, message: str, raw_text: Optional[str] = None):
        super().__init__(message)
        self.raw_text = raw_text


@dataclass
class ScanAnalysisResult:
    provider: str
    model: str
    candidates: list[DetectedBookCandidate]
    raw_text: str


def _format_httpx_error(provider_label: str, target_url: str, exc: httpx.HTTPError, read_timeout: float) -> str:
    err_name = type(exc).__name__
    err_detail = str(exc).strip()
    if isinstance(exc, httpx.ReadTimeout):
        return (
            f"Tiempo de espera agotado ({err_name} tras {int(read_timeout)}s) esperando respuesta "
            f"de {provider_label} ({target_url}). El modelo tardó demasiado en procesar la imagen; "
            f"prueba reduciendo STRATA_MAX_IMAGE_EDGE o aumentando STRATA_TIMEOUT_SECONDS."
        )
    if isinstance(exc, (httpx.ConnectTimeout, httpx.ConnectError)):
        return (
            f"No se pudo conectar con {provider_label} ({target_url}) [{err_name}"
            f"{': ' + err_detail if err_detail else ''}]. Comprueba que el servidor esté encendido "
            f"y accesible en esa IP y puerto."
        )
    return (
        f"Error de red con {provider_label} ({target_url}) [{err_name}"
        f"{': ' + err_detail if err_detail else ''}]."
    )


def _clean_json_text(text: str) -> str:
    # Remove trailing commas before closing } or ]
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return text


def _raw_decode_first_json(text: str) -> Any:
    decoder = json.JSONDecoder()
    for match in re.finditer(r"[\{\[]", text):
        try:
            obj, _end = decoder.raw_decode(text, match.start())
            return obj
        except json.JSONDecodeError:
            continue
    return None


def _recover_book_objects(text: str) -> list[dict[str, Any]]:
    """Fallback recovery: extract individually valid book JSON objects from truncated/dirty output."""
    decoder = json.JSONDecoder()
    recovered: list[dict[str, Any]] = []
    idx = 0
    length = len(text)
    while idx < length:
        brace = text.find("{", idx)
        if brace == -1:
            break
        # Skip the outer {"books": [ wrapper by trying decode; if it fails, move past this '{'
        try:
            obj, end_pos = decoder.raw_decode(text, brace)
            if isinstance(obj, dict) and ("title" in obj or "authors" in obj):
                recovered.append(obj)
                idx = end_pos
                continue
        except json.JSONDecodeError:
            pass
        idx = brace + 1
    return recovered


def _extract_json_payload(raw_text: str) -> Any:
    text = raw_text.strip()
    # Strip <think>...</think> reasoning blocks emitted by thinking models (e.g. Qwen3)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()
    # Strip markdown code fences if present
    fence_match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1).strip()

    # 1. Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Clean common LLM JSON quirks (trailing commas) and retry
    cleaned = _clean_json_text(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 3. Decode first valid JSON object/array ignoring leading/trailing commentary
    # Avoid returning a single inner book object when an outer "books" array was truncated/broken
    decoded = _raw_decode_first_json(cleaned)
    if decoded is not None:
        looks_like_single_inner_item = (
            isinstance(decoded, dict)
            and "title" in decoded
            and "books" not in decoded
            and '"books"' in cleaned
        )
        if not looks_like_single_inner_item:
            return decoded

    # 4. Try strict slice between first {/[ and last }/] for a clear error message if all else fails
    start_obj = cleaned.find("{")
    start_arr = cleaned.find("[")
    starts = [s for s in (start_obj, start_arr) if s != -1]
    if not starts:
        raise AIProviderError("La IA no devolvió un JSON válido.", raw_text=raw_text)
    start = min(starts)
    end = max(cleaned.rfind("}"), cleaned.rfind("]"))
    if end > start:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            # 5. Last resort: recover individual valid book objects from truncated/partially malformed output
            recovered = _recover_book_objects(cleaned)
            if recovered:
                logger.warning(
                    "JSON principal malformado (%s), recuperados %d libros individuales.",
                    exc,
                    len(recovered),
                )
                return {"books": recovered}
            raise AIProviderError(
                f"No se pudo interpretar el JSON devuelto por la IA: {exc}",
                raw_text=raw_text,
            ) from exc

    recovered = _recover_book_objects(cleaned)
    if recovered:
        return {"books": recovered}
    raise AIProviderError("La respuesta JSON de la IA está incompleta.", raw_text=raw_text)


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
            start = time.perf_counter()
            logger.debug(
                "[Gemini] POST %s (model=%s, image_bytes=%d, shelf=%r)",
                url,
                self.model,
                len(image_bytes),
                shelf_label,
            )
            try:
                resp = await client.post(url, params={"key": self.api_key}, json=body)
            except httpx.HTTPError as exc:
                msg = _format_httpx_error("Gemini", url, exc, 120.0)
                logger.warning("[Gemini] Error tras %.1fs: %s", time.perf_counter() - start, msg)
                raise AIProviderError(msg) from exc

        elapsed = time.perf_counter() - start
        logger.debug(
            "[Gemini] Respuesta HTTP %s en %.2fs (body_bytes=%d)",
            resp.status_code,
            elapsed,
            len(resp.content),
        )
        if resp.status_code >= 400:
            logger.warning("[Gemini] Error HTTP %s: %s", resp.status_code, resp.text[:600])
            raise AIProviderError(f"Gemini devolvió error {resp.status_code}: {resp.text[:400]}")

        data = resp.json()
        try:
            parts = data["candidates"][0]["content"]["parts"]
            raw_text = "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as exc:
            logger.warning("[Gemini] Estructura inesperada: %s", str(data)[:600])
            raise AIProviderError(f"Respuesta inesperada de Gemini: {str(data)[:300]}") from exc

        logger.debug(
            "[Gemini] raw_text (%d chars): %s",
            len(raw_text),
            raw_text[:800].replace("\n", "\\n"),
        )
        candidates = parse_detected_books(raw_text)
        logger.info(
            "[Gemini] Escaneo completado (model=%s, libros=%d, tiempo=%.2fs)",
            self.model,
            len(candidates),
            elapsed,
        )
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
            start = time.perf_counter()
            logger.debug(
                "[Gemini] complete_json model=%s prompt_chars=%d",
                self.model,
                len(user_prompt),
            )
            try:
                resp = await client.post(url, params={"key": self.api_key}, json=body)
            except httpx.HTTPError as exc:
                msg = _format_httpx_error("Gemini", url, exc, 120.0)
                logger.warning("[Gemini] complete_json error: %s", msg)
                raise AIProviderError(msg) from exc

        elapsed = time.perf_counter() - start
        logger.debug("[Gemini] complete_json HTTP %s en %.2fs", resp.status_code, elapsed)
        if resp.status_code >= 400:
            logger.warning("[Gemini] complete_json HTTP %s: %s", resp.status_code, resp.text[:600])
            raise AIProviderError(f"Gemini devolvió error {resp.status_code}: {resp.text[:400]}")

        data = resp.json()
        try:
            parts = data["candidates"][0]["content"]["parts"]
            raw_text = "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as exc:
            raise AIProviderError(f"Respuesta inesperada de Gemini: {str(data)[:300]}") from exc

        logger.debug(
            "[Gemini] complete_json raw (%d chars): %s",
            len(raw_text),
            raw_text[:600].replace("\n", "\\n"),
        )
        return _extract_json_payload(raw_text)


class StrataOpenAIProvider(AIProvider):
    provider_id = "strata"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: int = 300,
        max_image_edge: int = 1024,
        max_tokens: int = 3072,
        use_json_mode: bool = False,
        enable_thinking: bool = False,
    ):
        if not base_url.strip() or not api_key.strip():
            raise AIProviderError(
                "STRATA_BASE_URL y STRATA_API_KEY deben estar configurados en el archivo .env."
            )
        self.base_url = base_url.strip().rstrip("/")
        self.api_key = api_key.strip()
        self.model = model.strip()
        self.timeout_seconds = max(30, int(timeout_seconds))
        self.max_image_edge = int(max_image_edge)
        self.max_tokens = max(512, int(max_tokens))
        self.use_json_mode = bool(use_json_mode)
        self.enable_thinking = bool(enable_thinking)

    async def _stream_once(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        start: float,
    ) -> tuple[int, str, str]:
        """Execute a streaming chat completion request and collect content + reasoning progress.

        Returns (status_code, content_text, error_body).
        """
        stream_payload = {**payload, "stream": True}
        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        finish_reason: Optional[str] = None
        last_log_t = start

        async with client.stream("POST", url, headers=headers, json=stream_payload) as resp:
            if resp.status_code >= 400:
                err_bytes = await resp.aread()
                return resp.status_code, "", err_bytes.decode("utf-8", errors="replace")

            content_type = (resp.headers.get("content-type") or "").lower()
            # Handle servers that ignore stream=True and return regular application/json
            if "text/event-stream" not in content_type:
                raw_body = await resp.aread()
                data = json.loads(raw_body.decode("utf-8", errors="replace"))
                choice0 = (data.get("choices") or [{}])[0]
                msg = choice0.get("message") or {}
                content = msg.get("content") or ""
                if isinstance(content, list):
                    content = "".join(
                        p.get("text", "") for p in content if isinstance(p, dict)
                    )
                return resp.status_code, str(content), ""

            async for line in resp.aiter_lines():
                now = time.perf_counter()
                if now - start > self.timeout_seconds:
                    raise httpx.ReadTimeout(
                        f"Superado límite total de {self.timeout_seconds}s durante streaming"
                    )
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                if choices[0].get("finish_reason"):
                    finish_reason = choices[0]["finish_reason"]

                delta_content = delta.get("content")
                if isinstance(delta_content, str) and delta_content:
                    content_parts.append(delta_content)

                delta_reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                if isinstance(delta_reasoning, str) and delta_reasoning:
                    reasoning_parts.append(delta_reasoning)

                if now - last_log_t >= 5.0:
                    c_len = sum(len(x) for x in content_parts)
                    r_len = sum(len(x) for x in reasoning_parts)
                    tail = ("".join(content_parts[-8:]) or "".join(reasoning_parts[-8:]))[-100:]
                    logger.debug(
                        "[Strata] streaming %.1fs | content=%d chars | reasoning=%d chars | tail=%r",
                        now - start,
                        c_len,
                        r_len,
                        tail.replace("\n", "\\n"),
                    )
                    last_log_t = now

        full_content = "".join(content_parts)
        full_reasoning = "".join(reasoning_parts)
        elapsed = time.perf_counter() - start
        logger.debug(
            "[Strata] Stream finalizado en %.2fs (finish_reason=%s, content=%d chars, reasoning=%d chars)",
            elapsed,
            finish_reason,
            len(full_content),
            len(full_reasoning),
        )
        final_text = full_content if full_content.strip() else full_reasoning
        logger.debug(
            "[Strata] preview (%d chars): %s",
            len(final_text),
            final_text[:1000].replace("\n", "\\n"),
        )
        return 200, final_text, ""

    async def _post_chat_completions(self, payload: dict[str, Any]) -> str:
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        timeout = httpx.Timeout(
            connect=15.0,
            read=float(self.timeout_seconds),
            write=30.0,
            pool=15.0,
        )
        start = time.perf_counter()
        logger.debug(
            "[Strata] POST %s (model=%s, max_tokens=%s, json_mode=%s, thinking=%s, timeout=%ss)",
            url,
            self.model,
            payload.get("max_tokens"),
            "response_format" in payload,
            self.enable_thinking,
            self.timeout_seconds,
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                status_code, raw_text, err_text = await self._stream_once(
                    client, url, headers, payload, start
                )
            except httpx.HTTPError as exc:
                msg = _format_httpx_error("Strata", self.base_url, exc, self.timeout_seconds)
                logger.warning(
                    "[Strata] Request failed tras %.2fs: %s", time.perf_counter() - start, msg
                )
                raise AIProviderError(msg) from exc

            # Graceful fallback if server rejects optional extra keys (chat_template_kwargs / response_format)
            if status_code in (400, 422) and (
                "response_format" in payload or "chat_template_kwargs" in payload
            ):
                logger.debug(
                    "[Strata] HTTP %s con parámetros opcionales (%s); reintentando payload estándar",
                    status_code,
                    err_text[:200],
                )
                fallback_payload = {
                    k: v
                    for k, v in payload.items()
                    if k not in ("response_format", "chat_template_kwargs")
                }
                try:
                    status_code, raw_text, err_text = await self._stream_once(
                        client, url, headers, fallback_payload, start
                    )
                except httpx.HTTPError as exc:
                    msg = _format_httpx_error("Strata", self.base_url, exc, self.timeout_seconds)
                    logger.warning(
                        "[Strata] Fallback failed tras %.2fs: %s", time.perf_counter() - start, msg
                    )
                    raise AIProviderError(msg) from exc

        if status_code >= 400:
            err_msg = f"Strata devolvió error {status_code}: {err_text[:400]}"
            logger.warning("[Strata] %s", err_msg)
            raise AIProviderError(err_msg)

        if not raw_text.strip():
            raise AIProviderError("Strata devolvió una respuesta vacía.")
        return raw_text

    async def analyze_shelf_image(
        self,
        image_bytes: bytes,
        shelf_label: str,
        shelf_width_cm: float,
        shelf_height_cm: float,
        mime_type: str = "image/jpeg",
    ) -> ScanAnalysisResult:
        # Downscale image for local vision models so prefill stays fast while bbox stays normalized 0..1
        prepared_bytes = resize_image_bytes(image_bytes, max_long_edge=self.max_image_edge)
        logger.debug(
            "[Strata] Imagen preparada para visión: orig=%d bytes -> resized=%d bytes (max_edge=%d)",
            len(image_bytes),
            len(prepared_bytes),
            self.max_image_edge,
        )
        b64_image = base64.b64encode(prepared_bytes).decode("ascii")
        data_url = f"data:{mime_type};base64,{b64_image}"
        payload: dict[str, Any] = {
            "model": self.model,
            "temperature": 0.1,
            "max_tokens": self.max_tokens,
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
        if self.use_json_mode:
            payload["response_format"] = {"type": "json_object"}
        if not self.enable_thinking:
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        raw_text = await self._post_chat_completions(payload)
        candidates = parse_detected_books(raw_text)
        logger.info(
            "[Strata] Escaneo completado (model=%s, libros=%d)",
            self.model,
            len(candidates),
        )
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
            "max_tokens": self.max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if self.use_json_mode:
            payload["response_format"] = {"type": "json_object"}
        if not self.enable_thinking:
            payload["chat_template_kwargs"] = {"enable_thinking": False}
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
            timeout_seconds=settings.strata_timeout_seconds,
            max_image_edge=settings.strata_max_image_edge,
            max_tokens=settings.strata_max_tokens,
            use_json_mode=settings.strata_use_json_mode,
            enable_thinking=settings.strata_enable_thinking,
        )
    raise AIProviderError(f"Proveedor de IA desconocido: '{chosen}'. Usa 'gemini' o 'strata'.")
