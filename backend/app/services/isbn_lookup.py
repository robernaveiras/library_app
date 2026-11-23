import re
from typing import Any, Optional

import httpx

from app.config import settings
from app.schemas.scan import IsbnLookupResult


def normalize_isbn(raw: str) -> str:
    cleaned = re.sub(r"[^0-9Xx]", "", raw).upper()
    if len(cleaned) not in (10, 13):
        raise ValueError("El ISBN debe tener 10 o 13 dígitos.")
    return cleaned


def _parse_year(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    m = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", str(date_str))
    return int(m.group(1)) if m else None


def _parse_cm_to_mm(dim_str: Optional[str]) -> Optional[float]:
    if not dim_str:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*cm", str(dim_str), re.IGNORECASE)
    if m:
        return round(float(m.group(1)) * 10.0, 1)
    return None


def estimate_thickness_from_pages(page_count: Optional[int]) -> Optional[float]:
    if not page_count or page_count <= 0:
        return None
    return round(max(8.0, min(95.0, page_count * 0.065 + 4.0)), 1)


async def _fetch_google_books(client: httpx.AsyncClient, isbn: str) -> Optional[IsbnLookupResult]:
    params: dict[str, str] = {"q": f"isbn:{isbn}", "maxResults": "3"}
    if settings.google_books_api_key.strip():
        params["key"] = settings.google_books_api_key.strip()

    resp = await client.get("https://www.googleapis.com/books/v1/volumes", params=params)
    if resp.status_code != 200:
        return None

    data = resp.json()
    items = data.get("items") or []
    if not items:
        return None

    info: dict[str, Any] = items[0].get("volumeInfo") or {}
    title = (info.get("title") or "").strip()
    if not title:
        return None

    isbn_10 = None
    isbn_13 = None
    for ident in info.get("industryIdentifiers") or []:
        id_type = ident.get("type")
        val = ident.get("identifier")
        if id_type == "ISBN_10":
            isbn_10 = val
        elif id_type == "ISBN_13":
            isbn_13 = val

    if len(isbn) == 13 and not isbn_13:
        isbn_13 = isbn
    elif len(isbn) == 10 and not isbn_10:
        isbn_10 = isbn

    dims = info.get("dimensions") or {}
    height_mm = _parse_cm_to_mm(dims.get("height"))
    width_mm = _parse_cm_to_mm(dims.get("thickness"))
    dimensions_source = "api" if (height_mm or width_mm) else None

    page_count = info.get("pageCount")
    if isinstance(page_count, int) and page_count <= 0:
        page_count = None

    if width_mm is None and page_count:
        width_mm = estimate_thickness_from_pages(page_count)
        if dimensions_source is None:
            dimensions_source = "estimated"

    image_links = info.get("imageLinks") or {}
    cover_url = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    if isinstance(cover_url, str) and cover_url.startswith("http://"):
        cover_url = "https://" + cover_url[len("http://") :]

    return IsbnLookupResult(
        isbn=isbn,
        title=title,
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
        source="google_books",
    )


async def _fetch_open_library(client: httpx.AsyncClient, isbn: str) -> Optional[IsbnLookupResult]:
    key = f"ISBN:{isbn}"
    resp = await client.get(
        "https://openlibrary.org/api/books",
        params={"bibkeys": key, "format": "json", "jscmd": "data"},
    )
    if resp.status_code != 200:
        return None

    data = resp.json()
    entry = data.get(key)
    if not isinstance(entry, dict):
        return None

    title = (entry.get("title") or "").strip()
    if not title:
        return None

    authors = [
        a.get("name", "").strip()
        for a in (entry.get("authors") or [])
        if isinstance(a, dict) and a.get("name")
    ]
    publishers = [
        p.get("name", "").strip()
        for p in (entry.get("publishers") or [])
        if isinstance(p, dict) and p.get("name")
    ]

    identifiers = entry.get("identifiers") or {}
    isbn_10_list = identifiers.get("isbn_10") or []
    isbn_13_list = identifiers.get("isbn_13") or []
    isbn_10 = isbn_10_list[0] if isbn_10_list else (isbn if len(isbn) == 10 else None)
    isbn_13 = isbn_13_list[0] if isbn_13_list else (isbn if len(isbn) == 13 else None)

    page_count = entry.get("number_of_pages")
    if not isinstance(page_count, int) or page_count <= 0:
        page_count = None

    width_mm = estimate_thickness_from_pages(page_count)
    cover = entry.get("cover") or {}
    cover_url = cover.get("medium") or cover.get("large") or cover.get("small")

    return IsbnLookupResult(
        isbn=isbn,
        title=title,
        subtitle=entry.get("subtitle"),
        authors=authors,
        publisher=publishers[0] if publishers else None,
        published_year=_parse_year(entry.get("publish_date")),
        language=None,
        isbn_10=isbn_10,
        isbn_13=isbn_13,
        page_count=page_count,
        width_mm=width_mm,
        height_mm=None,
        dimensions_source="estimated" if width_mm else None,
        cover_url=cover_url,
        synopsis=None,
        source="open_library",
    )


async def lookup_isbn(raw_isbn: str) -> Optional[IsbnLookupResult]:
    isbn = normalize_isbn(raw_isbn)
    async with httpx.AsyncClient(timeout=12.0) as client:
        gb_result = None
        try:
            gb_result = await _fetch_google_books(client, isbn)
        except httpx.HTTPError:
            gb_result = None

        if gb_result and gb_result.cover_url and gb_result.page_count:
            return gb_result

        ol_result = None
        try:
            ol_result = await _fetch_open_library(client, isbn)
        except httpx.HTTPError:
            ol_result = None

        if gb_result and ol_result:
            # Merge missing fields from Open Library into Google Books result
            return gb_result.model_copy(
                update={
                    "cover_url": gb_result.cover_url or ol_result.cover_url,
                    "page_count": gb_result.page_count or ol_result.page_count,
                    "publisher": gb_result.publisher or ol_result.publisher,
                    "published_year": gb_result.published_year or ol_result.published_year,
                    "width_mm": gb_result.width_mm or ol_result.width_mm,
                    "dimensions_source": gb_result.dimensions_source or ol_result.dimensions_source,
                    "authors": gb_result.authors or ol_result.authors,
                }
            )
        return gb_result or ol_result
