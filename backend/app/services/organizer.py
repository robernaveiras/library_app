import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

from app.models import Book, Bookcase, Shelf, Tag
from app.schemas.organization import (
    AISuggestionScheme,
    DedicatedSectionRule,
    MoveStep,
    MoveStepBookItem,
    OrganizationCriteria,
    OrganizationMetrics,
    OrganizationPreviewResponse,
    SectionLegendItem,
    SortRule,
    TargetPlacementRecord,
    UnplacedBookWarning,
    VisualBookSlot,
    VisualBookcaseLayout,
    VisualShelfLayout,
)
from app.services.ai_providers import AIProvider
from app.services.isbn_lookup import estimate_thickness_from_pages

DEFAULT_WIDTH_MM = 25.0
DEFAULT_HEIGHT_MM = 215.0

# Curated editorial category palette (for category/section map — never physical spine color)
SECTION_PALETTE = [
    "#92400e",  # warm amber
    "#0f766e",  # teal
    "#1d4ed8",  # cobalt
    "#9d174d",  # plum
    "#15803d",  # forest
    "#6d28d9",  # violet
    "#b45309",  # ochre
    "#0369a1",  # deep sky
    "#b91c1c",  # crimson
    "#4338ca",  # indigo
    "#4d7c0f",  # olive
    "#57534e",  # warm slate
]

SUGGEST_SYSTEM_PROMPT = """Eres un experto bibliotecario y arquitecto de organización de bibliotecas domésticas.
Analiza el perfil real de la biblioteca del usuario (sus géneros, idiomas, categorías personalizadas, libros pendientes de leer, sagas y estanterías con medidas) y propón EXACTAMENTE 3 esquemas de organización distintos y prácticos, optimizados para ENCONTRAR CUALQUIER LIBRO RÁPIDAMENTE.

Devuelve ÚNICAMENTE un JSON válido con el formato {"suggestions": [...]}. Sin texto fuera del JSON.

Cada elemento de "suggestions" debe tener:
- "name": string corto en español (ej. "Pendientes a mano + Género y Autor")
- "summary": string de 1-2 frases explicando cómo queda organizada la biblioteca
- "why_easy_to_find": string explicando concretamente por qué facilita localizar libros en ESTA biblioteca
- "pros": lista de 2 a 3 ventajas breves
- "criteria": objeto con:
  - "name": mismo nombre
  - "description": descripción breve
  - "dedicated_sections": lista (puede estar vacía []) de secciones dedicadas opcionales:
    {"label": string, "match_type": "reading_status"|"tag"|"genre"|"language", "match_value": string, "target_bookcase_id": int|null, "target_shelf_id": int|null, "placement_order": "first"|"last"}
    (Nota: para "reading_status", usa "unread"; para "tag", usa el ID numérico del tag como string, ej. "1"; solo usa IDs que existan en los datos proporcionados).
  - "sort_rules": lista de 2 a 4 reglas ordenadas por prioridad:
    {"field": "reading_status"|"tag"|"genre"|"subgenre"|"language"|"author"|"series"|"title"|"published_year"|"publisher"|"height"|"pages"|"fiction_vs_nonfiction", "direction": "asc"|"desc", "tag_id": int|null}
  - "free_space_percent": número entre 5 y 20 (ej. 10)
  - "height_clearance_mm": 10
  - "keep_series_together": true
  - "keep_author_together": true
  - "include_unplaced_books": true

No propongas nunca organizar por color de los lomos.
"""


def _norm(text: Optional[str]) -> str:
    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", text.strip().lower())
    clean = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", clean)


def _author_sort_key(authors: list[str]) -> str:
    if not authors:
        return "zzz"
    primary = _norm(authors[0])
    if not primary:
        return "zzz"
    if "," in primary:
        return primary
    parts = primary.split()
    if len(parts) >= 2:
        # Handle common surname particles (de, del, la, le, van, von, di)
        if len(parts) >= 3 and parts[-2] in {"de", "del", "la", "le", "van", "von", "di", "da", "mac", "mc"}:
            surname = " ".join(parts[-2:])
            given = " ".join(parts[:-2])
        else:
            surname = parts[-1]
            given = " ".join(parts[:-1])
        return f"{surname}, {given}"
    return primary


def _palette_color_for(label: str) -> str:
    digest = hashlib.sha1(label.encode("utf-8")).digest()
    return SECTION_PALETTE[digest[0] % len(SECTION_PALETTE)]


@dataclass
class BookFact:
    book_id: int
    title: str
    authors: list[str]
    publisher: Optional[str]
    published_year: Optional[int]
    language: Optional[str]
    page_count: Optional[int]
    width_mm: float
    height_mm: float
    genre: Optional[str]
    subgenre: Optional[str]
    series_name: Optional[str]
    series_index: Optional[float]
    reading_status: str
    is_fiction: Optional[bool]
    tag_ids: set[int]
    tag_names_by_id: dict[int, str]
    tag_colors_by_id: dict[int, str]
    current_shelf_id: Optional[int]
    current_position_index: Optional[int]
    current_location_label: Optional[str]
    section_label: str = "General"
    section_color: str = "#57534e"


@dataclass
class ShelfBin:
    shelf_id: int
    bookcase_id: int
    bookcase_name: str
    label: str
    position_index: int
    width_cm: float
    height_cm: float
    effective_width_mm: float
    max_book_height_mm: float
    soft_target_mm: Optional[float] = None
    used_width_mm: float = 0.0
    books: list[BookFact] = field(default_factory=list)

    @property
    def full_label(self) -> str:
        return f"{self.bookcase_name} · {self.label}"

    @property
    def remaining_width_mm(self) -> float:
        return self.effective_width_mm - self.used_width_mm

    @property
    def fill_ratio(self) -> float:
        total_mm = max(1.0, self.width_cm * 10.0)
        return self.used_width_mm / total_mm

    def can_fit_height(self, book: BookFact) -> bool:
        return book.height_mm <= self.max_book_height_mm + 0.01

    def can_fit_block(
        self, block: list[BookFact], allow_tight: bool = False, use_soft_target: bool = False
    ) -> bool:
        block_w = sum(b.width_mm for b in block)
        if allow_tight:
            limit_w = self.width_cm * 10.0
        elif use_soft_target and self.soft_target_mm is not None:
            limit_w = min(self.effective_width_mm, self.soft_target_mm)
        else:
            limit_w = self.effective_width_mm
        if self.used_width_mm + block_w > limit_w + 0.01:
            return False
        return all(self.can_fit_height(b) for b in block)

    def add_book(self, book: BookFact) -> None:
        self.books.append(book)
        self.used_width_mm += book.width_mm


def _extract_book_facts(
    books: list[Book], shelf_label_by_id: dict[int, str]
) -> list[BookFact]:
    facts: list[BookFact] = []
    for b in books:
        try:
            authors = json.loads(b.authors_json or "[]")
            if not isinstance(authors, list):
                authors = []
        except json.JSONDecodeError:
            authors = []
        authors = [str(a).strip() for a in authors if str(a).strip()]

        try:
            extra = json.loads(b.extra_attributes_json or "{}")
            if not isinstance(extra, dict):
                extra = {}
        except json.JSONDecodeError:
            extra = {}

        width_mm = b.width_mm or estimate_thickness_from_pages(b.page_count) or DEFAULT_WIDTH_MM
        height_mm = b.height_mm or DEFAULT_HEIGHT_MM

        tag_ids: set[int] = set()
        tag_names: dict[int, str] = {}
        tag_colors: dict[int, str] = {}
        for bt in b.book_tags or []:
            if bt.tag is not None:
                tag_ids.add(bt.tag.id)
                tag_names[bt.tag.id] = bt.tag.name
                tag_colors[bt.tag.id] = bt.tag.color_hex

        cur_shelf_id = b.placement.shelf_id if b.placement else None
        cur_pos = b.placement.position_index if b.placement else None
        cur_label = shelf_label_by_id.get(cur_shelf_id) if cur_shelf_id is not None else None

        is_fiction = extra.get("is_fiction") if isinstance(extra.get("is_fiction"), bool) else None

        facts.append(
            BookFact(
                book_id=b.id,
                title=b.title,
                authors=authors,
                publisher=b.publisher,
                published_year=b.published_year,
                language=(b.language or "").lower() or None,
                page_count=b.page_count,
                width_mm=round(float(width_mm), 1),
                height_mm=round(float(height_mm), 1),
                genre=b.genre,
                subgenre=b.subgenre,
                series_name=b.series_name,
                series_index=b.series_index,
                reading_status=b.reading_status or "unknown",
                is_fiction=is_fiction,
                tag_ids=tag_ids,
                tag_names_by_id=tag_names,
                tag_colors_by_id=tag_colors,
                current_shelf_id=cur_shelf_id,
                current_position_index=cur_pos,
                current_location_label=cur_label,
            )
        )
    return facts


def _matches_dedicated_section(book: BookFact, rule: DedicatedSectionRule) -> bool:
    if rule.match_type == "reading_status":
        return book.reading_status.lower() == rule.match_value.strip().lower()
    if rule.match_type == "tag":
        try:
            tid = int(rule.match_value)
            return tid in book.tag_ids
        except ValueError:
            target = _norm(rule.match_value)
            return any(_norm(name) == target for name in book.tag_names_by_id.values())
    if rule.match_type == "genre":
        return _norm(book.genre) == _norm(rule.match_value)
    if rule.match_type == "language":
        return _norm(book.language) == _norm(rule.match_value)
    return False


def _section_label_and_color(
    book: BookFact,
    criteria: OrganizationCriteria,
    tags_by_id: dict[int, Tag],
    matched_section: Optional[DedicatedSectionRule] = None,
) -> tuple[str, str]:
    if matched_section is not None:
        if matched_section.match_type == "tag":
            try:
                t = tags_by_id.get(int(matched_section.match_value))
                if t:
                    return matched_section.label, t.color_hex
            except ValueError:
                pass
        if matched_section.match_type == "reading_status" and matched_section.match_value == "unread":
            return matched_section.label, "#d97706"
        return matched_section.label, _palette_color_for(matched_section.label)

    # Otherwise derive section label from the first grouping sort rule
    for rule in criteria.sort_rules:
        if rule.field == "tag" and rule.tag_id:
            t = tags_by_id.get(rule.tag_id)
            if t and rule.tag_id in book.tag_ids:
                return t.name, t.color_hex
        elif rule.field == "reading_status" and book.reading_status == "unread":
            return "Pendientes de leer", "#d97706"
        elif rule.field == "genre":
            lbl = book.genre or "Sin género"
            return lbl, _palette_color_for(lbl)
        elif rule.field == "fiction_vs_nonfiction":
            lbl = "Ficción" if book.is_fiction is True else "No ficción" if book.is_fiction is False else "Sin clasificar"
            return lbl, "#1d4ed8" if lbl == "Ficción" else "#0f766e" if lbl == "No ficción" else "#57534e"
        elif rule.field == "language":
            lbl = (book.language or "Sin idioma").upper()
            return f"Idioma {lbl}", _palette_color_for(lbl)
        elif rule.field == "publisher":
            lbl = book.publisher or "Otras editoriales"
            return lbl, _palette_color_for(lbl)

    fallback = book.genre or "General"
    return fallback, _palette_color_for(fallback)


def _rule_sort_component(book: BookFact, rule: SortRule) -> tuple[Any, ...]:
    f = rule.field
    if f == "reading_status":
        priority = (rule.priority_value or "unread").lower()
        order = {priority: 0, "reading": 1, "unread": 2, "read": 3, "unknown": 4}
        return (order.get(book.reading_status, 4),)
    if f == "tag":
        has_tag = 0 if (rule.tag_id is not None and rule.tag_id in book.tag_ids) else 1
        return (has_tag,)
    if f == "genre":
        val = _norm(book.genre)
        return (1 if not val else 0, val)
    if f == "subgenre":
        val = _norm(book.subgenre)
        return (1 if not val else 0, val)
    if f == "language":
        val = _norm(book.language)
        return (1 if not val else 0, val)
    if f == "author":
        return (_author_sort_key(book.authors),)
    if f == "series":
        sname = _norm(book.series_name)
        if sname:
            return (0, sname, book.series_index if book.series_index is not None else 9999.0)
        return (1, _norm(book.title), 0.0)
    if f == "title":
        return (_norm(book.title),)
    if f == "published_year":
        return (1 if book.published_year is None else 0, book.published_year or 0)
    if f == "publisher":
        val = _norm(book.publisher)
        return (1 if not val else 0, val)
    if f == "height":
        return (book.height_mm,)
    if f == "pages":
        return (1 if book.page_count is None else 0, book.page_count or 0)
    if f == "fiction_vs_nonfiction":
        return (0 if book.is_fiction is True else 1 if book.is_fiction is False else 2,)
    return (_norm(book.title),)


def _sort_books(books: list[BookFact], rules: list[SortRule]) -> list[BookFact]:
    effective_rules = list(rules) if rules else [
        SortRule(field="genre", direction="asc"),
        SortRule(field="author", direction="asc"),
        SortRule(field="series", direction="asc"),
        SortRule(field="title", direction="asc"),
    ]
    # Stable multi-pass sort from least significant rule to most significant rule
    ordered = sorted(books, key=lambda b: (_norm(b.title), b.book_id))
    for rule in reversed(effective_rules):
        reverse = rule.direction == "desc"
        ordered.sort(key=lambda b, r=rule: _rule_sort_component(b, r), reverse=reverse)
    return ordered


def _group_atomic_blocks(
    ordered_books: list[BookFact],
    keep_series_together: bool,
    keep_author_together: bool,
) -> list[list[BookFact]]:
    """Group consecutive books belonging to the same series (or author) so bin packing avoids splitting them."""
    if not ordered_books:
        return []
    blocks: list[list[BookFact]] = []

    def block_key(b: BookFact) -> Optional[str]:
        if keep_series_together and b.series_name:
            return f"series:{_norm(b.series_name)}"
        if keep_author_together and b.authors:
            return f"author:{_author_sort_key(b.authors)}"
        return None

    cur_block = [ordered_books[0]]
    cur_key = block_key(ordered_books[0])

    for b in ordered_books[1:]:
        k = block_key(b)
        # Keep blocks reasonably sized (<= 8 books) so huge single-author runs still flow across shelves smoothly
        if k is not None and k == cur_key and len(cur_block) < 8:
            cur_block.append(b)
        else:
            blocks.append(cur_block)
            cur_block = [b]
            cur_key = k
    blocks.append(cur_block)
    return blocks


def _configure_soft_targets(
    books_in_order: list[BookFact], candidate_bins: list[ShelfBin], balanced: bool
) -> None:
    if not balanced or len(candidate_bins) <= 1:
        for sb in candidate_bins:
            sb.soft_target_mm = None
        return

    total_books_mm = sum(b.width_mm for b in books_in_order)
    remaining_capacity_mm = sum(max(0.0, sb.effective_width_mm - sb.used_width_mm) for sb in candidate_bins)
    if remaining_capacity_mm <= 0 or total_books_mm <= 0:
        for sb in candidate_bins:
            sb.soft_target_mm = None
        return

    # Distribute proportionally across all candidate shelves (+12% buffer so sections don't fragment awkwardly)
    target_ratio = min(1.0, (total_books_mm / remaining_capacity_mm) * 1.12)
    for sb in candidate_bins:
        avail = max(0.0, sb.effective_width_mm - sb.used_width_mm)
        sb.soft_target_mm = sb.used_width_mm + avail * target_ratio


def _pack_group_into_bins(
    books_in_order: list[BookFact],
    candidate_bins: list[ShelfBin],
    all_bins: list[ShelfBin],
    criteria: OrganizationCriteria,
    warnings: list[str],
    unplaced: list[UnplacedBookWarning],
    balanced: bool = False,
) -> None:
    if not books_in_order:
        return
    if not candidate_bins:
        for b in books_in_order:
            unplaced.append(
                UnplacedBookWarning(
                    book_id=b.book_id,
                    title=b.title,
                    authors=b.authors,
                    width_mm=b.width_mm,
                    height_mm=b.height_mm,
                    reason="No hay baldas disponibles para esta sección.",
                )
            )
        return

    _configure_soft_targets(books_in_order, candidate_bins, balanced=balanced)

    blocks = _group_atomic_blocks(
        books_in_order,
        keep_series_together=criteria.keep_series_together,
        keep_author_together=criteria.keep_author_together,
    )
    cursor = 0

    for block in blocks:
        # In balanced mode, start a new section/genre on the next shelf if current shelf is already near its soft target
        if (
            balanced
            and cursor + 1 < len(candidate_bins)
            and candidate_bins[cursor].books
            and candidate_bins[cursor].soft_target_mm is not None
        ):
            prev_section = candidate_bins[cursor].books[-1].section_label
            next_section = block[0].section_label
            if (
                prev_section != next_section
                and candidate_bins[cursor].used_width_mm >= candidate_bins[cursor].soft_target_mm * 0.72
            ):
                cursor += 1

        # Advance cursor to first bin that can hold the block cleanly
        placed_whole_block = False
        if len(block) > 1:
            if cursor < len(candidate_bins) and candidate_bins[cursor].can_fit_block(
                block, use_soft_target=balanced
            ):
                for b in block:
                    candidate_bins[cursor].add_book(b)
                placed_whole_block = True
            else:
                cur_limit = (
                    candidate_bins[cursor].soft_target_mm
                    if (balanced and cursor < len(candidate_bins) and candidate_bins[cursor].soft_target_mm)
                    else (candidate_bins[cursor].effective_width_mm if cursor < len(candidate_bins) else 1.0)
                )
                cur_progress = (
                    candidate_bins[cursor].used_width_mm / max(1.0, cur_limit)
                    if cursor < len(candidate_bins)
                    else 0.0
                )
                search_start = cursor + 1 if cur_progress >= 0.55 else cursor
                for idx in range(search_start, len(candidate_bins)):
                    if candidate_bins[idx].can_fit_block(block, use_soft_target=balanced):
                        for b in block:
                            candidate_bins[idx].add_book(b)
                        cursor = idx
                        placed_whole_block = True
                        break

        if placed_whole_block:
            continue

        # Fall back to placing book-by-book in order
        for book in block:
            placed_book = False
            cursor_rejected_by_height = (
                cursor < len(candidate_bins)
                and not candidate_bins[cursor].can_fit_height(book)
            )

            # 1a. In balanced mode, try fitting within soft_target_mm from cursor onwards
            if balanced:
                for idx in range(cursor, len(candidate_bins)):
                    if candidate_bins[idx].can_fit_block([book], use_soft_target=True):
                        candidate_bins[idx].add_book(book)
                        if not cursor_rejected_by_height or idx == cursor:
                            cursor = idx
                        elif idx != cursor:
                            warnings.append(
                                f"«{book.title}» ({book.height_mm / 10:.1f} cm de alto) se ubicó en "
                                f"{candidate_bins[idx].full_label} ({candidate_bins[idx].height_cm:.1f} cm) por altura."
                            )
                        placed_book = True
                        break

            # 1b. Try from cursor onwards in candidate_bins (respecting free_space_percent)
            if not placed_book:
                for idx in range(cursor, len(candidate_bins)):
                    if candidate_bins[idx].can_fit_block([book], allow_tight=False):
                        candidate_bins[idx].add_book(book)
                        if not cursor_rejected_by_height or idx == cursor:
                            cursor = idx
                        elif idx != cursor:
                            warnings.append(
                                f"«{book.title}» ({book.height_mm / 10:.1f} cm de alto) se ubicó en "
                                f"{candidate_bins[idx].full_label} ({candidate_bins[idx].height_cm:.1f} cm) por altura."
                            )
                        placed_book = True
                        break

            # 2. Try earlier candidate_bins if we jumped ahead due to height/cohesion
            if not placed_book:
                for idx in range(0, cursor):
                    if candidate_bins[idx].can_fit_block([book], allow_tight=False):
                        candidate_bins[idx].add_book(book)
                        placed_book = True
                        break

            # 3. Try any shelf in candidate_bins using full physical width (ignoring free_space buffer)
            if not placed_book:
                for idx, sb in enumerate(candidate_bins):
                    if sb.can_fit_block([book], allow_tight=True):
                        sb.add_book(book)
                        if not cursor_rejected_by_height:
                            cursor = idx
                        placed_book = True
                        break

            # 4. If height didn't fit in candidate_bins, look for any taller shelf in all_bins
            if not placed_book:
                for sb in all_bins:
                    if sb.can_fit_block([book], allow_tight=True):
                        sb.add_book(book)
                        placed_book = True
                        warnings.append(
                            f"«{book.title}» ({book.height_mm / 10:.1f} cm de alto) se reubicó en "
                            f"{sb.full_label} ({sb.height_cm:.1f} cm) para que quepa físicamente."
                        )
                        break

            if not placed_book:
                max_shelf_h = max((sb.height_cm for sb in all_bins), default=0.0)
                if book.height_mm > (max_shelf_h * 10.0 - criteria.height_clearance_mm):
                    reason = (
                        f"Altura de {book.height_mm / 10:.1f} cm superior al alto útil máximo "
                        f"disponible ({max(0.0, max_shelf_h - criteria.height_clearance_mm / 10):.1f} cm)."
                    )
                else:
                    reason = (
                        "Sin espacio horizontal libre en las baldas compatibles; prueba a reducir "
                        "el porcentaje de espacio libre."
                    )
                unplaced.append(
                    UnplacedBookWarning(
                        book_id=book.book_id,
                        title=book.title,
                        authors=book.authors,
                        width_mm=book.width_mm,
                        height_mm=book.height_mm,
                        reason=reason,
                    )
                )


def _build_visual_bookcases(
    bookcases: list[Bookcase],
    shelf_slots: dict[int, list[VisualBookSlot]],
) -> list[VisualBookcaseLayout]:
    layouts: list[VisualBookcaseLayout] = []
    for bc in bookcases:
        shelf_layouts: list[VisualShelfLayout] = []
        for s in sorted(bc.shelves, key=lambda x: x.position_index):
            slots = shelf_slots.get(s.id, [])
            used_mm = round(sum(sl.width_mm for sl in slots), 1)
            fill_pct = round(min(100.0, (used_mm / max(1.0, s.width_cm * 10.0)) * 100.0), 1)
            shelf_layouts.append(
                VisualShelfLayout(
                    shelf_id=s.id,
                    bookcase_id=bc.id,
                    bookcase_name=bc.name,
                    label=s.label,
                    position_index=s.position_index,
                    width_cm=s.width_cm,
                    height_cm=s.height_cm,
                    used_width_mm=used_mm,
                    fill_percent=fill_pct,
                    books=slots,
                )
            )
        layouts.append(
            VisualBookcaseLayout(
                bookcase_id=bc.id,
                name=bc.name,
                location=bc.location,
                shelves=shelf_layouts,
            )
        )
    return layouts


def _generate_move_steps(
    bins: list[ShelfBin],
    current_shelf_order: dict[int, list[int]],
    facts_by_id: dict[int, BookFact],
    shelf_label_by_id: dict[int, str],
) -> tuple[list[MoveStep], int, int]:
    """Generate practical physical reordering steps grouped in 2 phases:
    Phase 1 ('clear'): pull out books that are leaving their current shelf onto a staging table.
    Phase 2 ('place'): populate each changed shelf cleanly from left to right.
    """
    target_shelf_of_book: dict[int, int] = {}
    target_pos_of_book: dict[int, int] = {}
    for sb in bins:
        for idx, b in enumerate(sb.books):
            target_shelf_of_book[b.book_id] = sb.shelf_id
            target_pos_of_book[b.book_id] = idx

    # Phase 1: Books moving AWAY from their current shelf -> group by source shelf
    leaving_by_source: dict[int, list[BookFact]] = defaultdict(list)
    books_moved = 0
    for bid, fact in facts_by_id.items():
        target_sid = target_shelf_of_book.get(bid)
        target_pos = target_pos_of_book.get(bid)
        if target_sid is None:
            continue
        if fact.current_shelf_id != target_sid or fact.current_position_index != target_pos:
            books_moved += 1
        if fact.current_shelf_id is not None and fact.current_shelf_id != target_sid:
            leaving_by_source[fact.current_shelf_id].append(fact)

    steps: list[MoveStep] = []
    step_num = 1

    # Order source shelves so the ones with most books leaving get cleared first
    for source_sid, leaving_books in sorted(
        leaving_by_source.items(), key=lambda kv: (-len(kv[1]), kv[0])
    ):
        source_label = shelf_label_by_id.get(source_sid, f"Balda {source_sid}")
        items = [
            MoveStepBookItem(
                book_id=b.book_id,
                title=b.title,
                authors=b.authors,
                from_label=source_label,
                to_label=shelf_label_by_id.get(target_shelf_of_book[b.book_id], "Destino"),
                section_label=b.section_label,
            )
            for b in sorted(leaving_books, key=lambda x: x.current_position_index or 0)
        ]
        steps.append(
            MoveStep(
                id=f"clear-{source_sid}",
                phase="clear",
                title=f"Paso {step_num}: Sacar {len(items)} libros de {source_label}",
                description=(
                    "Déjalos agrupados en una mesa o zona temporal para despejar esta balda "
                    "antes de colocar los definitivos."
                ),
                shelf_id=source_sid,
                shelf_label=source_label,
                books=items,
                done=False,
            )
        )
        step_num += 1

    # Phase 2: Place each shelf whose final book sequence changed
    shelves_touched = 0
    for sb in bins:
        final_ids = [b.book_id for b in sb.books]
        cur_ids = current_shelf_order.get(sb.shelf_id, [])
        if final_ids == cur_ids:
            continue
        shelves_touched += 1
        sections = list(dict.fromkeys(b.section_label for b in sb.books))
        sections_str = ", ".join(sections[:3]) + ("..." if len(sections) > 3 else "")
        items = [
            MoveStepBookItem(
                book_id=b.book_id,
                title=b.title,
                authors=b.authors,
                from_label=(
                    "Ya está en esta balda"
                    if b.current_shelf_id == sb.shelf_id
                    else f"Desde mesa ({b.current_location_label})"
                    if b.current_location_label
                    else "Sin ubicar actualmente"
                ),
                to_label=sb.full_label,
                section_label=b.section_label,
            )
            for b in sb.books
        ]
        steps.append(
            MoveStep(
                id=f"place-{sb.shelf_id}",
                phase="place",
                title=f"Paso {step_num}: Colocar {len(items)} libros en {sb.full_label}",
                description=(
                    f"Colócalos de izquierda a derecha. Secciones: {sections_str}."
                    if items
                    else "Esta balda queda libre / vacía."
                ),
                shelf_id=sb.shelf_id,
                shelf_label=sb.full_label,
                books=items,
                done=False,
            )
        )
        step_num += 1

    return steps, books_moved, shelves_touched


def compute_organization_preview(
    bookcases: list[Bookcase],
    books: list[Book],
    tags: list[Tag],
    criteria: OrganizationCriteria,
) -> OrganizationPreviewResponse:
    tags_by_id = {t.id: t for t in tags}

    # Filter bookcases if user chose a specific subset of bookcases to reorganize
    selected_bc_ids = set(criteria.bookcase_ids) if criteria.bookcase_ids else None
    active_bookcases = (
        [bc for bc in bookcases if bc.id in selected_bc_ids]
        if selected_bc_ids is not None
        else bookcases
    )

    # Build ordered ShelfBins across active bookcases
    bins: list[ShelfBin] = []
    shelf_label_by_id: dict[int, str] = {}
    shelf_bookcase_by_id: dict[int, int] = {}
    for bc in bookcases:
        for s in sorted(bc.shelves, key=lambda x: x.position_index):
            shelf_label_by_id[s.id] = f"{bc.name} · {s.label}"
            shelf_bookcase_by_id[s.id] = bc.id

    occupied_shelf_ids = {
        b.placement.shelf_id for b in books if b.placement is not None
    }

    active_shelf_ids: set[int] = set()
    for bc in active_bookcases:
        for s in sorted(bc.shelves, key=lambda x: x.position_index):
            if criteria.only_occupied_shelves and s.id not in occupied_shelf_ids:
                continue
            active_shelf_ids.add(s.id)
            eff_w = s.width_cm * 10.0 * (1.0 - criteria.free_space_percent / 100.0)
            max_h = max(50.0, s.height_cm * 10.0 - criteria.height_clearance_mm)
            bins.append(
                ShelfBin(
                    shelf_id=s.id,
                    bookcase_id=bc.id,
                    bookcase_name=bc.name,
                    label=s.label,
                    position_index=s.position_index,
                    width_cm=s.width_cm,
                    height_cm=s.height_cm,
                    effective_width_mm=eff_w,
                    max_book_height_mm=max_h,
                )
            )

    all_facts = _extract_book_facts(books, shelf_label_by_id)
    if selected_bc_ids is not None:
        # Only reorganize books currently inside the selected bookcases
        facts = [
            f
            for f in all_facts
            if f.current_shelf_id in active_shelf_ids
        ]
    elif not criteria.include_unplaced_books:
        facts = [f for f in all_facts if f.current_shelf_id is not None]
    else:
        facts = all_facts

    facts_by_id = {f.book_id: f for f in facts}

    # Partition books into dedicated sections vs general pool
    section_buckets: list[tuple[DedicatedSectionRule, list[BookFact]]] = [
        (sec, []) for sec in criteria.dedicated_sections
    ]
    general_books: list[BookFact] = []

    for bf in facts:
        matched_rule: Optional[DedicatedSectionRule] = None
        for idx, (sec, bucket) in enumerate(section_buckets):
            if _matches_dedicated_section(bf, sec):
                bucket.append(bf)
                matched_rule = sec
                break
        if matched_rule is None:
            general_books.append(bf)
        lbl, col = _section_label_and_color(bf, criteria, tags_by_id, matched_rule)
        bf.section_label = lbl
        bf.section_color = col

    # Build BEFORE layout (using the same section colors so visual comparison is crystal clear!)
    current_by_shelf: dict[int, list[BookFact]] = defaultdict(list)
    for bf in facts:
        if bf.current_shelf_id is not None:
            current_by_shelf[bf.current_shelf_id].append(bf)

    before_slots: dict[int, list[VisualBookSlot]] = {}
    current_shelf_order: dict[int, list[int]] = {}
    for sid, sbooks in current_by_shelf.items():
        sbooks.sort(key=lambda x: (x.current_position_index or 0, x.book_id))
        current_shelf_order[sid] = [b.book_id for b in sbooks]
        before_slots[sid] = [
            VisualBookSlot(
                book_id=b.book_id,
                title=b.title,
                authors=b.authors,
                genre=b.genre,
                series_name=b.series_name,
                series_index=b.series_index,
                reading_status=b.reading_status,
                width_mm=b.width_mm,
                height_mm=b.height_mm,
                position_index=idx,
                section_label=b.section_label,
                section_color=b.section_color,
                moved=False,
                from_location=b.current_location_label,
            )
            for idx, b in enumerate(sbooks)
        ]

    # Sort each bucket and pack into ShelfBins
    warnings: list[str] = []
    unplaced: list[UnplacedBookWarning] = []
    use_balanced = criteria.pack_mode in ("balanced", "per_bookcase")

    if criteria.pack_mode == "per_bookcase":
        # Reorder each bookcase's books independently inside that bookcase's own shelves
        bins_by_bc: dict[int, list[ShelfBin]] = defaultdict(list)
        for sb in bins:
            bins_by_bc[sb.bookcase_id].append(sb)

        facts_by_bc: dict[int, list[BookFact]] = defaultdict(list)
        unassigned_facts: list[BookFact] = []
        for bf in facts:
            bc_id = shelf_bookcase_by_id.get(bf.current_shelf_id) if bf.current_shelf_id else None
            if bc_id is not None and bc_id in bins_by_bc:
                facts_by_bc[bc_id].append(bf)
            else:
                unassigned_facts.append(bf)

        for bc in active_bookcases:
            bc_bins = bins_by_bc.get(bc.id, [])
            bc_facts = facts_by_bc.get(bc.id, [])
            if not bc_facts:
                continue

            bc_first: list[BookFact] = []
            bc_last: list[BookFact] = []
            bc_general: list[BookFact] = []
            for bf in bc_facts:
                matched_sec = next(
                    (sec for sec in criteria.dedicated_sections if _matches_dedicated_section(bf, sec)),
                    None,
                )
                if matched_sec is not None:
                    if matched_sec.placement_order == "last":
                        bc_last.append(bf)
                    else:
                        bc_first.append(bf)
                else:
                    bc_general.append(bf)

            bc_seq = (
                _sort_books(bc_first, criteria.sort_rules)
                + _sort_books(bc_general, criteria.sort_rules)
                + _sort_books(bc_last, criteria.sort_rules)
            )
            _pack_group_into_bins(
                bc_seq, bc_bins, bc_bins, criteria, warnings, unplaced, balanced=True
            )

        if unassigned_facts:
            _pack_group_into_bins(
                _sort_books(unassigned_facts, criteria.sort_rules),
                bins,
                bins,
                criteria,
                warnings,
                unplaced,
                balanced=True,
            )
    else:
        # 1. Dedicated sections pinned to a specific shelf or bookcase first
        targeted_sections = [
            (sec, _sort_books(bucket, criteria.sort_rules))
            for sec, bucket in section_buckets
            if sec.target_shelf_id is not None or sec.target_bookcase_id is not None
        ]
        first_sections = [
            (sec, _sort_books(bucket, criteria.sort_rules))
            for sec, bucket in section_buckets
            if sec.target_shelf_id is None
            and sec.target_bookcase_id is None
            and sec.placement_order == "first"
        ]
        last_sections = [
            (sec, _sort_books(bucket, criteria.sort_rules))
            for sec, bucket in section_buckets
            if sec.target_shelf_id is None
            and sec.target_bookcase_id is None
            and sec.placement_order == "last"
        ]

        for sec, sorted_bucket in targeted_sections:
            if sec.target_shelf_id is not None:
                target_bins = [sb for sb in bins if sb.shelf_id == sec.target_shelf_id]
            else:
                target_bins = [sb for sb in bins if sb.bookcase_id == sec.target_bookcase_id]
            _pack_group_into_bins(
                sorted_bucket, target_bins, bins, criteria, warnings, unplaced, balanced=use_balanced
            )

        # 2. Pack "first" sections, then general books, then "last" sections sequentially across all shelves
        main_sequence: list[BookFact] = []
        for _sec, sorted_bucket in first_sections:
            main_sequence.extend(sorted_bucket)
        main_sequence.extend(_sort_books(general_books, criteria.sort_rules))
        for _sec, sorted_bucket in last_sections:
            main_sequence.extend(sorted_bucket)

        _pack_group_into_bins(
            main_sequence, bins, bins, criteria, warnings, unplaced, balanced=use_balanced
        )

    # Build AFTER layout & target placement records
    after_slots: dict[int, list[VisualBookSlot]] = {}
    target_placements: list[TargetPlacementRecord] = []
    for sb in bins:
        slots: list[VisualBookSlot] = []
        for idx, b in enumerate(sb.books):
            moved = b.current_shelf_id != sb.shelf_id or b.current_position_index != idx
            slots.append(
                VisualBookSlot(
                    book_id=b.book_id,
                    title=b.title,
                    authors=b.authors,
                    genre=b.genre,
                    series_name=b.series_name,
                    series_index=b.series_index,
                    reading_status=b.reading_status,
                    width_mm=b.width_mm,
                    height_mm=b.height_mm,
                    position_index=idx,
                    section_label=b.section_label,
                    section_color=b.section_color,
                    moved=moved,
                    from_location=b.current_location_label,
                )
            )
            target_placements.append(
                TargetPlacementRecord(book_id=b.book_id, shelf_id=sb.shelf_id, position_index=idx)
            )
        after_slots[sb.shelf_id] = slots

    before_bookcases = _build_visual_bookcases(active_bookcases, before_slots)
    after_bookcases = _build_visual_bookcases(active_bookcases, after_slots)

    # Legend sorted by book count
    sec_counts = Counter((b.section_label, b.section_color) for b in facts)
    legend = [
        SectionLegendItem(label=lbl, color_hex=col, count=cnt)
        for (lbl, col), cnt in sec_counts.most_common()
    ]

    move_steps, books_moved, shelves_touched = _generate_move_steps(
        bins=bins,
        current_shelf_order=current_shelf_order,
        facts_by_id=facts_by_id,
        shelf_label_by_id=shelf_label_by_id,
    )

    placed_count = len(target_placements)
    avg_fill = (
        round(
            sum(
                min(100.0, (sb.used_width_mm / max(1.0, sb.width_cm * 10.0)) * 100.0)
                for sb in bins
            )
            / float(len(bins)),
            1,
        )
        if bins
        else 0.0
    )

    # Deduplicate warnings while preserving order
    dedup_warnings = list(dict.fromkeys(warnings))
    if unplaced:
        dedup_warnings.insert(
            0,
            f"{len(unplaced)} libro(s) no cupieron físicamente en ninguna balda. Revisa el detalle abajo.",
        )

    return OrganizationPreviewResponse(
        criteria=criteria,
        before_bookcases=before_bookcases,
        after_bookcases=after_bookcases,
        legend=legend,
        move_steps=move_steps,
        unplaced_books=unplaced,
        warnings=dedup_warnings,
        metrics=OrganizationMetrics(
            total_books=len(facts),
            placed_books=placed_count,
            unplaced_books=len(unplaced),
            books_moved=books_moved,
            books_unchanged=max(0, placed_count - books_moved),
            shelves_touched=shelves_touched,
            average_fill_percent=avg_fill,
        ),
        target_placements=target_placements,
    )


async def suggest_organization_with_ai(
    ai: AIProvider,
    bookcases: list[Bookcase],
    books: list[Book],
    tags: list[Tag],
    user_goal: Optional[str] = None,
) -> list[AISuggestionScheme]:
    """Ask AI to propose 3 practical organization criteria tailored to the user's real library."""
    genres = Counter(b.genre or "Sin género" for b in books)
    languages = Counter((b.language or "desconocido").lower() for b in books)
    statuses = Counter(b.reading_status or "unknown" for b in books)
    series_count = len({b.series_name for b in books if b.series_name})

    bookcases_profile = [
        {
            "bookcase_id": bc.id,
            "name": bc.name,
            "location": bc.location,
            "shelves": [
                {
                    "shelf_id": s.id,
                    "label": s.label,
                    "width_cm": s.width_cm,
                    "height_cm": s.height_cm,
                }
                for s in sorted(bc.shelves, key=lambda x: x.position_index)
            ],
        }
        for bc in bookcases
    ]
    tags_profile = [
        {"tag_id": t.id, "name": t.name, "book_count": len(t.book_tags or [])}
        for t in tags
    ]

    profile = {
        "total_books": len(books),
        "genres": dict(genres.most_common(20)),
        "languages": dict(languages.most_common(10)),
        "reading_statuses": dict(statuses),
        "distinct_series_count": series_count,
        "custom_tags": tags_profile,
        "bookcases": bookcases_profile,
    }

    user_prompt = (
        f"Perfil de mi biblioteca:\n{json.dumps(profile, ensure_ascii=False)}\n\n"
        f"{'Preferencia adicional del usuario: ' + user_goal.strip() if user_goal and user_goal.strip() else ''}\n"
        'Propón 3 esquemas distintos en JSON {"suggestions": [...]} pensados para encontrar libros rápido.'
    )

    raw = await ai.complete_json(SUGGEST_SYSTEM_PROMPT, user_prompt)
    raw_list = raw.get("suggestions") if isinstance(raw, dict) else raw
    if not isinstance(raw_list, list):
        return []

    valid_bookcase_ids = {bc.id for bc in bookcases}
    valid_shelf_ids = {s.id for bc in bookcases for s in bc.shelves}
    valid_tag_ids = {t.id for t in tags}

    suggestions: list[AISuggestionScheme] = []
    for item in raw_list[:4]:
        if not isinstance(item, dict):
            continue
        raw_crit = item.get("criteria")
        if not isinstance(raw_crit, dict):
            continue

        # Sanitize dedicated sections and sort rules so invalid AI IDs never crash validation
        sanitized_sections = []
        for sec in raw_crit.get("dedicated_sections") or []:
            if not isinstance(sec, dict):
                continue
            mtype = sec.get("match_type")
            mval = str(sec.get("match_value") or "").strip()
            if mtype not in ("reading_status", "tag", "genre", "language") or not mval:
                continue
            if mtype == "tag":
                try:
                    if int(mval) not in valid_tag_ids:
                        continue
                except ValueError:
                    continue
            t_bc = sec.get("target_bookcase_id")
            if t_bc not in valid_bookcase_ids:
                t_bc = None
            t_sh = sec.get("target_shelf_id")
            if t_sh not in valid_shelf_ids:
                t_sh = None
            p_ord = sec.get("placement_order") if sec.get("placement_order") in ("first", "last") else "first"
            sanitized_sections.append(
                DedicatedSectionRule(
                    label=str(sec.get("label") or mval)[:100],
                    match_type=mtype,
                    match_value=mval[:120],
                    target_bookcase_id=t_bc,
                    target_shelf_id=t_sh,
                    placement_order=p_ord,
                )
            )

        valid_fields = {
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
        }
        sanitized_rules = []
        for r in raw_crit.get("sort_rules") or []:
            if not isinstance(r, dict):
                continue
            rf = r.get("field")
            if rf not in valid_fields:
                continue
            rdir = r.get("direction") if r.get("direction") in ("asc", "desc") else "asc"
            rtid = r.get("tag_id")
            if rf == "tag":
                if rtid not in valid_tag_ids:
                    continue
            else:
                rtid = None
            sanitized_rules.append(SortRule(field=rf, direction=rdir, tag_id=rtid))

        if not sanitized_rules:
            sanitized_rules = [
                SortRule(field="genre", direction="asc"),
                SortRule(field="author", direction="asc"),
                SortRule(field="series", direction="asc"),
            ]

        name = str(item.get("name") or raw_crit.get("name") or "Propuesta IA").strip()[:150]
        criteria = OrganizationCriteria(
            name=name,
            description=str(raw_crit.get("description") or item.get("summary") or "")[:1000] or None,
            dedicated_sections=sanitized_sections,
            sort_rules=sanitized_rules,
            free_space_percent=max(0.0, min(50.0, float(raw_crit.get("free_space_percent", 10.0)))),
            height_clearance_mm=max(0.0, min(50.0, float(raw_crit.get("height_clearance_mm", 10.0)))),
            keep_series_together=bool(raw_crit.get("keep_series_together", True)),
            keep_author_together=bool(raw_crit.get("keep_author_together", True)),
            include_unplaced_books=bool(raw_crit.get("include_unplaced_books", True)),
        )
        pros = [str(p).strip() for p in (item.get("pros") or []) if str(p).strip()][:4]
        suggestions.append(
            AISuggestionScheme(
                name=name,
                summary=str(item.get("summary") or "").strip() or name,
                why_easy_to_find=str(item.get("why_easy_to_find") or "").strip()
                or "Agrupa tus libros con criterios claros y predecibles.",
                pros=pros,
                criteria=criteria,
            )
        )

    return suggestions
