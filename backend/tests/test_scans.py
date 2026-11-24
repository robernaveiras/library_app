from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base, create_sqlite_engine, get_db
from app.main import app
from app.routers import scans as scans_router
from app.schemas.scan import DetectedBookCandidate, IsbnLookupResult
from app.services.ai_providers import (
    AIProvider,
    ScanAnalysisResult,
    _format_httpx_error,
    parse_detected_books,
)
from app.services.image_utils import estimate_dimensions_from_bbox, resize_image_bytes


class FakeAIProvider(AIProvider):
    provider_id = "strata"
    model = "Qwen3.8-Flash-Next-Gyro-M"

    async def analyze_shelf_image(
        self,
        image_bytes: bytes,
        shelf_label: str,
        shelf_width_cm: float,
        shelf_height_cm: float,
        mime_type: str = "image/jpeg",
    ) -> ScanAnalysisResult:
        return ScanAnalysisResult(
            provider=self.provider_id,
            model=self.model,
            raw_text='{"books": []}',
            candidates=[
                DetectedBookCandidate(
                    position_index=0,
                    title="Dune",
                    authors=["Frank Herbert"],
                    publisher="Debolsillo",
                    language="es",
                    orientation="vertical",
                    confidence=0.95,
                    bbox=[0.05, 0.1, 0.11, 0.85],
                ),
                DetectedBookCandidate(
                    position_index=1,
                    title="La mano izquierda de la oscuridad",
                    authors=["Ursula K. Le Guin"],
                    publisher="Minotauro",
                    language="es",
                    orientation="vertical",
                    confidence=0.62,
                    notes="Lomo algo borroso",
                    bbox=[0.11, 0.12, 0.16, 0.85],
                ),
            ],
        )

    async def complete_json(self, system_prompt: str, user_prompt: str):
        return {}


def make_test_client(tmp_path):
    db_file = tmp_path / "test_scans.db"
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


def make_sample_jpeg() -> bytes:
    buf = BytesIO()
    img = Image.new("RGB", (800, 300), color=(210, 195, 175))
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_parse_detected_books_handles_fences_and_1000_bbox():
    raw = """```json
    {
      "books": [
        {
          "title": "Ficciones",
          "authors": ["Jorge Luis Borges"],
          "publisher": "Alianza",
          "language": "es",
          "confidence": 0.92,
          "bbox": [100, 150, 180, 900]
        },
        {
          "title": "Libro borroso",
          "authors": "Autor Desconocido",
          "confidence": 0.35,
          "bbox": [500, 500, 400, 600]
        }
      ]
    }
    ```"""
    parsed = parse_detected_books(raw)
    assert len(parsed) == 2
    assert parsed[0].title == "Ficciones"
    assert parsed[0].bbox == [0.1, 0.15, 0.18, 0.9]
    assert parsed[1].authors == ["Autor Desconocido"]
    assert parsed[1].bbox is None  # invalid x_max < x_min discarded


def test_estimate_dimensions_from_bbox():
    w, h = estimate_dimensions_from_bbox([0.1, 0.15, 0.15, 0.85], shelf_width_cm=80.0, shelf_height_cm=30.0)
    assert w == 40.0  # 0.05 * 800 mm
    assert h == 210.0  # 0.70 * 300 mm


def test_full_scan_and_confirm_workflow(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "data"))
    monkeypatch.setattr(scans_router, "get_ai_provider", lambda **_kwargs: FakeAIProvider())

    client = make_test_client(tmp_path)

    # Create bookcase with 1 shelf
    bc = client.post(
        "/api/bookcases",
        json={
            "name": "Salón",
            "initial_shelves": {"count": 1, "width_cm": 80.0, "height_cm": 30.0},
        },
    ).json()
    shelf_id = bc["shelves"][0]["id"]

    # Upload photo & run scan
    resp_scan = client.post(
        f"/api/shelves/{shelf_id}/scans",
        files={"file": ("balda1.jpg", make_sample_jpeg(), "image/jpeg")},
        data={"provider": "strata"},
    )
    assert resp_scan.status_code == 201
    scan = resp_scan.json()
    assert scan["status"] == "reviewed"
    assert scan["ai_provider"] == "strata"
    assert len(scan["candidates"]) == 2

    # Image endpoint serves saved JPEG
    resp_img = client.get(scan["image_url"])
    assert resp_img.status_code == 200
    assert resp_img.headers["content-type"] == "image/jpeg"

    # Confirm 2 books (replacing existing)
    resp_confirm = client.post(
        f"/api/scans/{scan['id']}/confirm",
        json={
            "replace_existing": True,
            "books": [
                {
                    "title": "Dune",
                    "authors": ["Frank Herbert"],
                    "publisher": "Debolsillo",
                    "language": "es",
                    "reading_status": "read",
                    "confidence": 0.95,
                    "bbox": [0.05, 0.1, 0.11, 0.85],
                },
                {
                    "title": "La mano izquierda de la oscuridad",
                    "authors": ["Ursula K. Le Guin"],
                    "reading_status": "unread",
                    "confidence": 0.62,
                    "bbox": [0.11, 0.12, 0.16, 0.85],
                },
            ],
        },
    )
    assert resp_confirm.status_code == 200
    confirmed = resp_confirm.json()
    assert confirmed["confirmed_count"] == 2
    assert confirmed["books"][0]["dimensions_source"] == "visual_calibration"
    assert confirmed["books"][0]["width_mm"] == 48.0  # 0.06 * 800 mm

    # Verify bookcase shelf counts updated
    bc_updated = client.get(f"/api/bookcases/{bc['id']}").json()
    assert bc_updated["total_books"] == 2
    assert bc_updated["shelves"][0]["book_count"] == 2
    assert bc_updated["shelves"][0]["used_width_cm"] > 0

    # Append 1 more book via second confirm (replace_existing=False)
    resp_append = client.post(
        f"/api/scans/{scan['id']}/confirm",
        json={
            "replace_existing": False,
            "books": [{"title": "Solaris", "authors": ["Stanisław Lem"], "width_mm": 22.0}],
        },
    )
    assert resp_append.status_code == 200
    assert len(resp_append.json()["books"]) == 3
    assert resp_append.json()["books"][2]["position_index"] == 2


def test_isbn_lookup_endpoint(tmp_path, monkeypatch):
    async def fake_lookup(raw_isbn: str):
        if raw_isbn == "9788497596824":
            return IsbnLookupResult(
                isbn="9788497596824",
                title="Dune",
                authors=["Frank Herbert"],
                isbn_13="9788497596824",
                page_count=784,
                width_mm=55.0,
                dimensions_source="estimated",
                source="google_books",
            )
        return None

    monkeypatch.setattr(scans_router, "lookup_isbn", fake_lookup)
    client = make_test_client(tmp_path)

    r_ok = client.get("/api/isbn/9788497596824")
    assert r_ok.status_code == 200
    assert r_ok.json()["title"] == "Dune"

    r_404 = client.get("/api/isbn/0000000000")
    assert r_404.status_code == 404


def test_parse_strips_think_tags_and_formats_read_timeout():
    import httpx

    raw = """<think>
    Veo un libro con texto {algo} en el lomo.
    </think>
    {"books": [{"title": "El Aleph", "authors": ["Borges"], "confidence": 0.9}]}"""
    parsed = parse_detected_books(raw)
    assert len(parsed) == 1
    assert parsed[0].title == "El Aleph"

    msg = _format_httpx_error("Strata", "http://192.168.1.186:47832/v1", httpx.ReadTimeout(""), 300)
    assert "ReadTimeout" in msg
    assert "300s" in msg

    big_buf = BytesIO()
    Image.new("RGB", (2048, 1536), color=(180, 180, 180)).save(big_buf, format="JPEG")
    resized = resize_image_bytes(big_buf.getvalue(), max_long_edge=1280)
    assert max(Image.open(BytesIO(resized)).size) == 1280


def test_parse_recovers_trailing_commas_and_truncated_json():
    dirty = """Aquí tienes los libros:
    {
      "books": [
        {"title": "Dune", "authors": ["Frank Herbert"], "confidence": 0.95,},
        {"title": "Solaris", "authors": ["Stanisław Lem"], "confidence": 0.88},
      ]
    }
    Nota final: {espero que ayude}"""
    parsed = parse_detected_books(dirty)
    assert [b.title for b in parsed] == ["Dune", "Solaris"]

    truncated = """{
      "books": [
        {"title": "Libro 1", "authors": ["Autor 1"], "confidence": 0.9},
        {"title": "Libro 2", "authors": ["Autor 2"], "confidence": 0.8},
        {"title": "Libro 3 cortado", "authors": ["Aut"""
    recovered = parse_detected_books(truncated)
    assert [b.title for b in recovered] == ["Libro 1", "Libro 2"]
