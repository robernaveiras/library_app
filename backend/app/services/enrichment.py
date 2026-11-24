import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

from app.config import settings
from app.services.isbn_lookup import (
    _fetch_google_books,
    _fetch_open_library,
    _parse_cm_to_mm,
    _parse_year,
    estimate_thickness_from_pages,
)


@dataclass
class EnrichmentCandidate:
    title: Optional[str] = None
    subtitle: Optional[str] = None
    authors: list[str] = field(default_factory=list)
    publisher: Optional[str] = None
    published_year: Optional[int] = None
    language: Optional[str] = None
    isbn_10: Optional[str] = None
    isbn_13: Optional[str] = None
    page_count: Optional[int] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    dimensions_source: Optional[str] = None
    cover_url: Optional[str] = None
    synopsis: Optional[str] = None
    categories: list[str] = field(default_factory=list)
    source: str = "google_books"


def _normalize_text(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text.lower())
    without_accents = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9\s]", " ", without_accents).strip()


def _token_overlap(a: str, b: str) -> float:
    ta = {t for t in _normalize_text(a).split() if len(t) > 1}
    tb = {t for t in _normalize_text(b).split() if len(t) > 1}
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return inter / float(max(len(ta), len(tb)))


def _score_candidate(
    query_title: str,
    query_authors: list[str],
    query_language: Optional[str],
    cand_title: str,
    cand_authors: list[str],
    cand_language: Optional[str],
    has_cover: bool,
    has_pages: bool,
) -> float:
    norm_qt = _normalize_text(query_title)
    norm_ct = _normalize_text(cand_title)

    if norm_qt and norm_qt == norm_ct:
        title_score = 1.0
    elif norm_qt and (norm_qt in norm_ct or norm_ct in norm_qt):
        title_score = 0.85
    else:
        title_score = _token_overlap(query_title, cand_title)

    author_score = 0.0
    if query_authors and cand_authors:
        qa_joined = " ".join(query_authors)
        ca_joined = " ".join(cand_authors)
        author_score = _token_overlap(qa_joined, ca_joined)
    elif not query_authors:
        author_score = 0.4

    score = title_score * 0.65 + author_score * 0.35

    # Mild tie-breaking bonuses
    if query_language and cand_language and cand_language.lower().startswith(query_language.lower()[:2]):
        score += 0.08
    if has_cover:
        score += 0.04
    if has_pages:
        score += 0.03
    return score


def _parse_google_volume(info: dict[str, Any]) -> EnrichmentCandidate:
    isbn_10 = None
    isbn_13 = None
    for ident in info.get("industryIdentifiers") or []:
        t = ident.get("type")
        val = ident.get("identifier")
        if t == "ISBN_10":
            isbn_10 = val
        elif t == "ISBN_13":
            isbn_13 = val

    dims = info.get("dimensions") or {}
    height_mm = _parse_cm_to_mm(dims.get("height"))
    width_mm = _parse_cm_to_mm(dims.get("thickness"))
    dimensions_source = "api" if (height_mm or width_mm) else None

    page_count = info.get("pageCount")
    if not isinstance(page_count, int) or page_count <= 0:
        page_count = None

    if width_mm is None and page_count:
        width_mm = estimate_thickness_from_pages(page_count)
        if dimensions_source is None:
            dimensions_source = "estimated"

    image_links = info.get("imageLinks") or {}
    cover_url = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    if isinstance(cover_url, str) and cover_url.startswith("http://"):
        cover_url = "https://" + cover_url[len("http://") :]

    return EnrichmentCandidate(
        title=(info.get("title") or "").strip() or None,
        subtitle=info.get("subtitle"),
        authors=[a.strip() for a in (info.get("authors") or []) if isinstance(a, str) and a.strip()],
        publisher=info.get("publisher"),
        published_year=_parse_year(info.get("publishedDate")),
        language=info.get("language"),
        isbn_10=isbn_10,
        isbn_13=isbn_13,
        page_count=page_count,
        width_mm=width_mm,
        height_mm=height_mm,
        dimensions_source=dimensions_source,
        cover_url=cover_url,
        synopsis=info.get("description"),
        categories=[c.strip() for c in (info.get("categories") or []) if isinstance(c, str) and c.strip()],
        source="google_books",
    )


async def _search_google_books(
    client: httpx.AsyncClient,
    title: str,
    authors: list[str],
    language: Optional[str],
) -> Optional[EnrichmentCandidate]:
    clean_title = title.strip()
    if not clean_title:
        return None

    queries: list[tuple[str, Optional[str]]] = []
    if authors:
        first_author = authors[0].strip()
        q = f'intitle:"{clean_title}" inauthor:"{first_author}"'
        if language and len(language) == 2:
            queries.append((q, language.lower()))
        queries.append((q, None))
        queries.append((f"{clean_title} {first_author}", None))
    else:
        if language and len(language) == 2:
            queries.append((f'intitle:"{clean_title}"', language.lower()))
        queries.append((f'intitle:"{clean_title}"', None))

    best_candidate: Optional[EnrichmentCandidate] = None
    best_score = 0.0

    for query_str, lang_restrict in queries:
        params: dict[str, str] = {"q": query_str, "maxResults": "5"}
        if lang_restrict:
            params["langRestrict"] = lang_restrict
        if settings.google_books_api_key.strip():
            params["key"] = settings.google_books_api_key.strip()

        try:
            resp = await client.get("https://www.googleapis.com/books/v1/volumes", params=params)
        except httpx.HTTPError:
            continue
        if resp.status_code != 200:
            continue

        items = resp.json().get("items") or []
        for item in items:
            info = item.get("volumeInfo") or {}
            cand = _parse_google_volume(info)
            if not cand.title:
                continue
            score = _score_candidate(
                query_title=clean_title,
                query_authors=authors,
                query_language=language,
                cand_title=cand.title,
                cand_authors=cand.authors,
                cand_language=cand.language,
                has_cover=bool(cand.cover_url),
                has_pages=bool(cand.page_count),
            )
            if score > best_score:
                best_score = score
                best_candidate = cand

        if best_score >= 0.72:
            break

    if best_score < 0.42:
        return None
    return best_candidate


async def _search_open_library(
    client: httpx.AsyncClient,
    title: str,
    authors: list[str],
    language: Optional[str],
) -> Optional[EnrichmentCandidate]:
    clean_title = title.strip()
    if not clean_title:
        return None

    params: dict[str, str] = {"title": clean_title, "limit": "5"}
    if authors:
        params["author"] = authors[0].strip()

    try:
        resp = await client.get("https://openlibrary.org/search.json", params=params)
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None

    docs = resp.json().get("docs") or []
    best_candidate: Optional[EnrichmentCandidate] = None
    best_score = 0.0

    for doc in docs:
        cand_title = (doc.get("title") or "").strip()
        if not cand_title:
            continue
        cand_authors = [
            str(a).strip() for a in (doc.get("author_name") or []) if str(a).strip()
        ]
        cover_i = doc.get("cover_i")
        cover_url = f"https://covers.openlibrary.org/b/id/{cover_i}-M.jpg" if cover_i else None

        isbns = [str(i).strip() for i in (doc.get("isbn") or []) if str(i).strip()]
        isbn_13 = next((i for i in isbns if len(i) == 13), None)
        isbn_10 = next((i for i in isbns if len(i) == 10), None)

        pages = doc.get("number_of_pages_median")
        if not isinstance(pages, int) or pages <= 0:
            pages = None

        publishers = [str(p).strip() for p in (doc.get("publisher") or []) if str(p).strip()]
        width_mm = estimate_thickness_from_pages(pages)

        score = _score_candidate(
            query_title=clean_title,
            query_authors=authors,
            query_language=language,
            cand_title=cand_title,
            cand_authors=cand_authors,
            cand_language=None,
            has_cover=bool(cover_url),
            has_pages=bool(pages),
        )
        if score > best_score:
            best_score = score
            best_candidate = EnrichmentCandidate(
                title=cand_title,
                authors=cand_authors,
                publisher=publishers[0] if publishers else None,
                published_year=doc.get("first_publish_year")
                if isinstance(doc.get("first_publish_year"), int)
                else None,
                isbn_10=isbn_10,
                isbn_13=isbn_13,
                page_count=pages,
                width_mm=width_mm,
                height_mm=None,
                dimensions_source="estimated" if width_mm else None,
                cover_url=cover_url,
                source="open_library",
            )

    if best_score < 0.45:
        return None
    return best_candidate


def _merge_candidates(
    primary: Optional[EnrichmentCandidate], secondary: Optional[EnrichmentCandidate]
) -> Optional[EnrichmentCandidate]:
    if not primary:
        return secondary
    if not secondary:
        return primary
    return EnrichmentCandidate(
        title=primary.title or secondary.title,
        subtitle=primary.subtitle or secondary.subtitle,
        authors=primary.authors or secondary.authors,
        publisher=primary.publisher or secondary.publisher,
        published_year=primary.published_year or secondary.published_year,
        language=primary.language or secondary.language,
        isbn_10=primary.isbn_10 or secondary.isbn_10,
        isbn_13=primary.isbn_13 or secondary.isbn_13,
        page_count=primary.page_count or secondary.page_count,
        width_mm=primary.width_mm or secondary.width_mm,
        height_mm=primary.height_mm or secondary.height_mm,
        dimensions_source=primary.dimensions_source or secondary.dimensions_source,
        cover_url=primary.cover_url or secondary.cover_url,
        synopsis=primary.synopsis or secondary.synopsis,
        categories=primary.categories or secondary.categories,
        source=f"{primary.source}+{secondary.source}",
    )


async def fetch_book_enrichment(
    title: str,
    authors: list[str],
    language: Optional[str] = None,
    isbn_13: Optional[str] = None,
    isbn_10: Optional[str] = None,
) -> Optional[EnrichmentCandidate]:
    """Fetch best metadata from Google Books (primary) and Open Library (fallback/complement)."""
    async with httpx.AsyncClient(timeout=12.0) as client:
        # 1. If we already have an ISBN, do an exact lookup first
        isbn = (isbn_13 or isbn_10 or "").strip()
        if isbn:
            gb_isbn = None
            ol_isbn = None
            try:
                res = await _fetch_google_books(client, isbn)
                if res:
                    gb_isbn = EnrichmentCandidate(
                        title=res.title,
                        subtitle=res.subtitle,
                        authors=res.authors,
                        publisher=res.publisher,
                        published_year=res.published_year,
                        language=res.language,
                        isbn_10=res.isbn_10,
                        isbn_13=res.isbn_13,
                        page_count=res.page_count,
                        width_mm=res.width_mm,
                        height_mm=res.height_mm,
                        dimensions_source=res.dimensions_source,
                        cover_url=res.cover_url,
                        synopsis=res.synopsis,
                        source="google_books",
                    )
            except httpx.HTTPError:
                gb_isbn = None

            if not (gb_isbn and gb_isbn.cover_url and gb_isbn.page_count):
                try:
                    res_ol = await _fetch_open_library(client, isbn)
                    if res_ol:
                        ol_isbn = EnrichmentCandidate(
                            title=res_ol.title,
                            subtitle=res_ol.subtitle,
                            authors=res_ol.authors,
                            publisher=res_ol.publisher,
                            published_year=res_ol.published_year,
                            language=res_ol.language,
                            isbn_10=res_ol.isbn_10,
                            isbn_13=res_ol.isbn_13,
                            page_count=res_ol.page_count,
                            width_mm=res_ol.width_mm,
                            height_mm=res_ol.height_mm,
                            dimensions_source=res_ol.dimensions_source,
                            cover_url=res_ol.cover_url,
                            synopsis=res_ol.synopsis,
                            source="open_library",
                        )
                except httpx.HTTPError:
                    ol_isbn = None

            merged_isbn = _merge_candidates(gb_isbn, ol_isbn)
            if merged_isbn:
                return merged_isbn

        # 2. Search by title + author
        gb_search = await _search_google_books(client, title, authors, language)
        if gb_search and gb_search.cover_url and gb_search.page_count and (gb_search.isbn_13 or gb_search.isbn_10):
            return gb_search

        ol_search = await _search_open_library(client, title, authors, language)
        return _merge_candidates(gb_search, ol_search)
