from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import Base, create_sqlite_engine, get_db
from app.main import app
from app.routers import books as books_router
from app.services.enrichment import EnrichmentCandidate


def make_test_client(tmp_path):
    db_file = tmp_path / "test_books.db"
    engine = create_sqlite_engine(f"sqlite:///{db_file}")
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_books_crud_filtering_and_shelf_move(tmp_path):
    client = make_test_client(tmp_path)

    bc = client.post(
        "/api/bookcases",
        json={
            "name": "Despacho",
            "initial_shelves": {"count": 2, "width_cm": 80.0, "height_cm": 30.0},
        },
    ).json()
    shelf1_id = bc["shelves"][0]["id"]
    shelf2_id = bc["shelves"][1]["id"]

    # Create 2 books on shelf 1
    b1 = client.post(
        "/api/books",
        json={
            "title": "Dune",
            "authors": ["Frank Herbert"],
            "language": "es",
            "page_count": 700,
            "reading_status": "read",
            "shelf_id": shelf1_id,
        },
    ).json()
    assert b1["width_mm"] is not None
    assert b1["dimensions_source"] == "estimated"
    assert b1["placement"]["shelf_id"] == shelf1_id

    b2 = client.post(
        "/api/books",
        json={
            "title": "Los desposeídos",
            "authors": ["Ursula K. Le Guin"],
            "language": "es",
            "reading_status": "unread",
            "shelf_id": shelf1_id,
        },
    ).json()

    # Search and filter
    assert len(client.get("/api/books", params={"q": "guin"}).json()) == 1
    assert len(client.get("/api/books", params={"reading_status": "unread"}).json()) == 1

    # Stats check
    stats = client.get("/api/books/stats").json()
    assert stats["total_books"] == 2
    assert stats["unread_count"] == 1
    assert stats["needs_enrichment_count"] == 2

    # Move b1 to shelf 2 and set manual dimensions
    b1_upd = client.patch(
        f"/api/books/{b1['id']}",
        json={"shelf_id": shelf2_id, "width_mm": 45.0, "height_mm": 225.0, "genre": "Ciencia ficción"},
    ).json()
    assert b1_upd["placement"]["shelf_id"] == shelf2_id
    assert b1_upd["dimensions_source"] == "manual"
    assert b1_upd["width_mm"] == 45.0

    # Remaining book on shelf 1 should have re-normalized position_index 0
    b2_refreshed = client.get(f"/api/books/{b2['id']}").json()
    assert b2_refreshed["placement"]["position_index"] == 0

    # Delete b2
    assert client.delete(f"/api/books/{b2['id']}").status_code == 204
    assert len(client.get("/api/books").json()) == 1


def test_single_and_batch_enrichment_preserves_manual_dimensions(tmp_path, monkeypatch):
    async def fake_fetch(title, authors, language=None, isbn_13=None, isbn_10=None):
        if "Dune" in title:
            return EnrichmentCandidate(
                title="Dune",
                authors=["Frank Herbert"],
                publisher="Debolsillo",
                published_year=2021,
                language="es",
                isbn_13="9788497596824",
                page_count=784,
                width_mm=52.0,
                height_mm=230.0,
                dimensions_source="api",
                cover_url="https://example.com/dune.jpg",
                synopsis="Arrakis...",
                categories=["Fiction / Science Fiction"],
                source="google_books",
            )
        return None

    monkeypatch.setattr(books_router, "fetch_book_enrichment", fake_fetch)
    client = make_test_client(tmp_path)

    # Book with manual dimensions that should NOT be overwritten by enrichment
    b1 = client.post(
        "/api/books",
        json={"title": "Dune", "authors": ["Frank Herbert"], "width_mm": 40.0, "height_mm": 210.0},
    ).json()
    assert b1["dimensions_source"] == "manual"

    b2 = client.post(
        "/api/books",
        json={"title": "Libro Inexistente XYZ", "authors": ["Nadie"]},
    ).json()

    # Batch enrich
    batch = client.post("/api/books/enrich-batch", json={"only_missing": True}).json()
    assert batch["processed"] == 2
    assert batch["enriched"] == 1
    assert batch["not_found"] == 1

    b1_after = client.get(f"/api/books/{b1['id']}").json()
    assert b1_after["isbn_13"] == "9788497596824"
    assert b1_after["cover_url"] == "https://example.com/dune.jpg"
    assert b1_after["genre"] == "Fiction"
    assert b1_after["enrichment_status"] == "enriched"
    assert b1_after["needs_enrichment"] is False
    # Manual dimensions preserved!
    assert b1_after["width_mm"] == 40.0
    assert b1_after["height_mm"] == 210.0
    assert b1_after["dimensions_source"] == "manual"

    # Unmatched book should now be marked not_found and NOT pending anymore
    b2_after = client.get(f"/api/books/{b2['id']}").json()
    assert b2_after["enrichment_status"] == "not_found"
    assert b2_after["needs_enrichment"] is False

    stats_after = client.get("/api/books/stats").json()
    assert stats_after["enriched_books"] == 1
    assert stats_after["not_found_enrichment_count"] == 1
    assert stats_after["needs_enrichment_count"] == 0

    # Single enrich for unmatched book returns matched=False gracefully
    single = client.post(f"/api/books/{b2['id']}/enrich", json={"overwrite": False}).json()
    assert single["matched"] is False
