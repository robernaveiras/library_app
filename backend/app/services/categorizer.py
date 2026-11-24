import json
from dataclasses import dataclass, field
from typing import Any, Optional

from app.services.ai_providers import AIProvider

CATEGORIZE_SYSTEM_PROMPT = """Eres un bibliotecario experto en catalogación literaria en español.
Tu tarea es normalizar la categoría de una lista de libros para que una biblioteca personal quede coherente y fácil de explorar.

Reglas obligatorias:
1. Devuelve ÚNICAMENTE un JSON válido con el formato {"books": [...]}. Sin texto adicional.
2. Usa nombres de género principal ("genre") consistentes y limpios EN ESPAÑOL (por ejemplo: "Ciencia ficción", "Fantasía", "Novela contemporánea", "Novela histórica", "Misterio y novela negra", "Terror", "Clásicos", "Ensayo", "Historia", "Filosofía", "Biografía y memorias", "Divulgación científica", "Psicología y desarrollo", "Política y sociedad", "Arte y diseño", "Poesía", "Teatro", "Cómic y novela gráfica", "Viajes", "Infantil y juvenil", "Economía y empresa", "Tecnología"). Si ya existen géneros previos en la biblioteca que encajen, reutilízalos para mantener coherencia.
3. Para cada libro de entrada devuelve un objeto con:
   - "book_id": int (el mismo id recibido)
   - "genre": string (género principal en español)
   - "subgenre": string o null (subgénero específico en español, ej. "Space opera", "Distopía", "Segunda Guerra Mundial")
   - "series_name": string o null (nombre de la saga/serie si pertenece claramente a una; null si es autoconclusivo)
   - "series_index": number o null (número de volumen en la saga, ej. 1, 2, 3; null si no aplica)
   - "is_fiction": boolean (true para ficción/narrativa/poesía/teatro/cómic de ficción, false para no ficción)
   - "author_gender": "mujer" | "hombre" | "mixto" | "desconocido"
   - "author_region": string o null (ej. "España", "Latinoamérica", "Estados Unidos", "Reino Unido", "Europa", "Japón", etc.)
"""

TAG_EVAL_SYSTEM_PROMPT = """Eres un bibliotecario experto que clasifica libros según un criterio personalizado definido por el usuario.

Reglas obligatorias:
1. Devuelve ÚNICAMENTE un JSON válido con el formato {"matches": [...]}. Sin texto fuera del JSON.
2. Incluye en "matches" ÚNICAMENTE los libros que SÍ cumplen el criterio indicado por el usuario (o tienen alta probabilidad de cumplirlo).
3. Sé preciso y honesto: no incluyas libros si no tienes base real para afirmar que cumplen el criterio.
4. Para cada coincidencia devuelve:
   - "book_id": int (el mismo id recibido)
   - "confidence": number entre 0.0 y 1.0 (usa >= 0.85 si es un hecho claro, 0.6-0.84 si es probable)
   - "reason": string breve en español (máximo 120 caracteres) explicando por qué cumple el criterio.
"""


@dataclass
class CategorizedBookResult:
    book_id: int
    genre: Optional[str] = None
    subgenre: Optional[str] = None
    series_name: Optional[str] = None
    series_index: Optional[float] = None
    extra_attributes: dict[str, Any] = field(default_factory=dict)


@dataclass
class TagEvalMatch:
    book_id: int
    confidence: float
    reason: Optional[str] = None


def _chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


async def categorize_books_batch(
    ai: AIProvider,
    book_payloads: list[dict[str, Any]],
    existing_genres: list[str],
    batch_size: int = 25,
) -> dict[int, CategorizedBookResult]:
    """Normalize genre, subgenre, series, and extensible attributes for a list of books."""
    results: dict[int, CategorizedBookResult] = {}

    for chunk in _chunked(book_payloads, batch_size):
        user_prompt = (
            f"Géneros existentes en la biblioteca (reutilízalos cuando encajen): "
            f"{json.dumps(existing_genres, ensure_ascii=False)}\n\n"
            f"Libros a categorizar:\n{json.dumps(chunk, ensure_ascii=False)}"
        )
        data = await ai.complete_json(CATEGORIZE_SYSTEM_PROMPT, user_prompt)
        raw_list = data.get("books") if isinstance(data, dict) else data
        if not isinstance(raw_list, list):
            continue

        for item in raw_list:
            if not isinstance(item, dict) or "book_id" not in item:
                continue
            try:
                bid = int(item["book_id"])
            except (TypeError, ValueError):
                continue

            genre = str(item.get("genre") or "").strip()[:100] or None
            subgenre = str(item.get("subgenre") or "").strip()[:100] or None
            series_name = str(item.get("series_name") or "").strip()[:200] or None

            series_index: Optional[float] = None
            raw_idx = item.get("series_index")
            if raw_idx is not None and raw_idx != "":
                try:
                    series_index = float(raw_idx)
                except (TypeError, ValueError):
                    series_index = None

            extra: dict[str, Any] = {}
            if isinstance(item.get("is_fiction"), bool):
                extra["is_fiction"] = item["is_fiction"]
            author_gender = str(item.get("author_gender") or "").strip().lower()
            if author_gender in ("mujer", "hombre", "mixto", "desconocido"):
                extra["author_gender"] = author_gender
            author_region = str(item.get("author_region") or "").strip()[:80]
            if author_region:
                extra["author_region"] = author_region

            results[bid] = CategorizedBookResult(
                book_id=bid,
                genre=genre,
                subgenre=subgenre,
                series_name=series_name,
                series_index=series_index,
                extra_attributes=extra,
            )

    return results


async def evaluate_tag_rule_batch(
    ai: AIProvider,
    tag_name: str,
    rule_prompt: str,
    book_payloads: list[dict[str, Any]],
    batch_size: int = 30,
) -> list[TagEvalMatch]:
    """Evaluate which books satisfy a user's custom natural-language category rule."""
    matches_by_id: dict[int, TagEvalMatch] = {}

    for chunk in _chunked(book_payloads, batch_size):
        user_prompt = (
            f"Categoría personalizada: {tag_name}\n"
            f"Criterio del usuario: {rule_prompt}\n\n"
            f"Libros a evaluar:\n{json.dumps(chunk, ensure_ascii=False)}"
        )
        data = await ai.complete_json(TAG_EVAL_SYSTEM_PROMPT, user_prompt)
        raw_list = data.get("matches") if isinstance(data, dict) else data
        if not isinstance(raw_list, list):
            continue

        for item in raw_list:
            if not isinstance(item, dict) or "book_id" not in item:
                continue
            try:
                bid = int(item["book_id"])
            except (TypeError, ValueError):
                continue
            try:
                conf = float(item.get("confidence", 0.75))
            except (TypeError, ValueError):
                conf = 0.75
            conf = round(max(0.0, min(1.0, conf)), 2)
            reason = str(item.get("reason") or "").strip()[:180] or None

            prev = matches_by_id.get(bid)
            if prev is None or conf > prev.confidence:
                matches_by_id[bid] = TagEvalMatch(book_id=bid, confidence=conf, reason=reason)

    return sorted(matches_by_id.values(), key=lambda m: (-m.confidence, m.book_id))
