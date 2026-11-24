from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import Base, create_sqlite_engine, get_db
from app.main import app
from app.routers import organization as org_router
from app.services.ai_providers import AIProvider, ScanAnalysisResult


class FakeOrgAI(AIProvider):
    provider_id = "gemini"
    model = "gemini-2.5-flash"

    async def analyze_shelf_image(self, *args, **kwargs) -> ScanAnalysisResult:
        raise NotImplementedError

    async def complete_json(self, system_prompt: str, user_prompt: str):
        return {
            "suggestions": [
                {
                    "name": "Pendientes primero + Género y Autor",
                    "summary": "Separa tus pendientes de leer y ordena el resto por género y autor.",
                    "why_easy_to_find": "Encuentras cualquier libro en segundos sabiendo su temática y apellido del autor.",
                    "pros": ["Pendientes siempre visibles", "Sagas juntas"],
                    "criteria": {
                        "name": "Pendientes primero + Género y Autor",
                        "dedicated_sections": [
                            {
                                "label": "Pendientes de leer",
                                "match_type": "reading_status",
                                "match_value": "unread",
                                "placement_order": "first",
                            }
                        ],
                        "sort_rules": [
                            {"field": "genre", "direction": "asc"},
                            {"field": "author", "direction": "asc"},
                            {"field": "series", "direction": "asc"},
                        ],
                        "free_space_percent": 10,
                        "height_clearance_mm": 10,
                        "keep_series_together": True,
                        "keep_author_together": True,
                        "include_unplaced_books": True,
                    },
                }
            ]
        }


def make_test_client(tmp_path):
    db_file = tmp_path / "test_org.db"
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


def test_organization_physical_packing_custom_sections_and_plan_apply(tmp_path, monkeypatch):
    monkeypatch.setattr(org_router, "get_ai_provider", lambda **_kwargs: FakeOrgAI())
    client = make_test_client(tmp_path)

    # Create bookcase with 2 shelves: top is 25 cm high, bottom is 36 cm high
    bc = client.post(
        "/api/bookcases",
        json={"name": "Salón"},
    ).json()
    s_short = client.post(
        f"/api/bookcases/{bc['id']}/shelves",
        json={"label": "Balda superior", "width_cm": 50.0, "height_cm": 25.0},
    ).json()
    s_tall = client.post(
        f"/api/bookcases/{bc['id']}/shelves",
        json={"label": "Balda inferior", "width_cm": 50.0, "height_cm": 36.0},
    ).json()

    # Create custom tag "Escritos por mujeres"
    tag = client.post(
        "/api/tags",
        json={"name": "Escritos por mujeres", "color_hex": "#9d174d"},
    ).json()

    # Add 4 books (including 1 tall art book 320 mm that only fits on s_tall!)
    b_tall = client.post(
        "/api/books",
        json={
            "title": "Atlas de Arquitectura",
            "authors": ["Ana Ruiz"],
            "genre": "Arte",
            "width_mm": 40.0,
            "height_mm": 320.0,
            "reading_status": "read",
            "shelf_id": s_short["id"],  # currently misplaced on short shelf
        },
    ).json()
    b_unread = client.post(
        "/api/books",
        json={
            "title": "Los desposeídos",
            "authors": ["Ursula K. Le Guin"],
            "genre": "Ciencia ficción",
            "width_mm": 30.0,
            "height_mm": 210.0,
            "reading_status": "unread",
            "shelf_id": s_tall["id"],
        },
    ).json()
    b_dune1 = client.post(
        "/api/books",
        json={
            "title": "Dune",
            "authors": ["Frank Herbert"],
            "genre": "Ciencia ficción",
            "series_name": "Dune",
            "series_index": 1,
            "width_mm": 45.0,
            "height_mm": 215.0,
            "reading_status": "read",
            "shelf_id": s_tall["id"],
        },
    ).json()
    b_dune2 = client.post(
        "/api/books",
        json={
            "title": "El mesías de Dune",
            "authors": ["Frank Herbert"],
            "genre": "Ciencia ficción",
            "series_name": "Dune",
            "series_index": 2,
            "width_mm": 25.0,
            "height_mm": 215.0,
            "reading_status": "read",
            "shelf_id": s_short["id"],
        },
    ).json()

    # Tag Ursula K. Le Guin with "Escritos por mujeres"
    client.put(f"/api/books/{b_unread['id']}/tags", json={"tag_ids": [tag["id"]]})

    # 1. AI Suggestions
    sugg_resp = client.post("/api/organization/suggest", json={"provider": "gemini"})
    assert sugg_resp.status_code == 200
    assert len(sugg_resp.json()["suggestions"]) == 1

    # 2. Preview with dedicated section ("Escritos por mujeres" first) + genre -> author -> series
    criteria = {
        "name": "Autoras primero + Género y Sagas",
        "pack_mode": "compact",
        "dedicated_sections": [
            {
                "label": "Escritos por mujeres",
                "match_type": "tag",
                "match_value": str(tag["id"]),
                "placement_order": "first",
            }
        ],
        "sort_rules": [
            {"field": "genre", "direction": "asc"},
            {"field": "author", "direction": "asc"},
            {"field": "series", "direction": "asc"},
        ],
        "free_space_percent": 10.0,
        "height_clearance_mm": 10.0,
        "keep_series_together": True,
        "keep_author_together": True,
        "include_unplaced_books": True,
    }
    prev_resp = client.post("/api/organization/preview", json=criteria)
    assert prev_resp.status_code == 200
    preview = prev_resp.json()
    assert preview["metrics"]["placed_books"] == 4
    assert preview["metrics"]["unplaced_books"] == 0

    # Verify tall book (320mm) was placed on the 36cm shelf, NOT the 25cm shelf!
    after_shelves = preview["after_bookcases"][0]["shelves"]
    short_book_ids = [b["book_id"] for b in after_shelves[0]["books"]]
    tall_book_ids = [b["book_id"] for b in after_shelves[1]["books"]]
    assert b_tall["id"] in tall_book_ids
    assert b_tall["id"] not in short_book_ids
    # "Escritos por mujeres" book should be first on top shelf
    assert short_book_ids[0] == b_unread["id"]
    # Dune 1 and Dune 2 should be adjacent in series order
    assert b_dune1["id"] in short_book_ids and b_dune2["id"] in short_book_ids
    assert short_book_ids.index(b_dune1["id"]) < short_book_ids.index(b_dune2["id"])
    assert len(preview["move_steps"]) >= 2

    # 3. Save plan, mark first step done, then apply plan to DB
    plan = client.post("/api/organization/plans", json={"criteria": criteria}).json()
    assert plan["status"] == "draft"
    first_step_id = plan["preview"]["move_steps"][0]["id"]

    prog = client.patch(
        f"/api/organization/plans/{plan['id']}/steps",
        json={"step_id": first_step_id, "done": True},
    ).json()
    assert prog["status"] == "in_progress"
    assert prog["preview"]["move_steps"][0]["done"] is True

    applied = client.post(f"/api/organization/plans/{plan['id']}/apply").json()
    assert applied["status"] == "applied"
    assert all(s["done"] for s in applied["preview"]["move_steps"])

    # Verify real book placements in SQLite now match the applied plan!
    b_tall_after = client.get(f"/api/books/{b_tall['id']}").json()
    assert b_tall_after["placement"]["shelf_id"] == s_tall["id"]
    b_unread_after = client.get(f"/api/books/{b_unread['id']}").json()
    assert b_unread_after["placement"]["shelf_id"] == s_short["id"]
    assert b_unread_after["placement"]["position_index"] == 0


def test_organization_balanced_and_per_bookcase_modes(tmp_path):
    client = make_test_client(tmp_path)

    bc1 = client.post(
        "/api/bookcases",
        json={"name": "Despacho", "initial_shelves": {"count": 1, "width_cm": 80.0, "height_cm": 30.0}},
    ).json()
    bc2 = client.post(
        "/api/bookcases",
        json={"name": "Salón", "initial_shelves": {"count": 2, "width_cm": 80.0, "height_cm": 30.0}},
    ).json()

    s1 = bc1["shelves"][0]["id"]
    s2_a = bc2["shelves"][0]["id"]
    s2_b = bc2["shelves"][1]["id"]

    # Put 4 books in Despacho and 4 in Salón Balda 2 (leaving Salón Balda 1 empty)
    for idx, title in enumerate(["Zeta", "Alfa", "Gamma", "Beta"]):
        client.post(
            "/api/books",
            json={"title": f"D-{title}", "width_mm": 30.0, "height_mm": 200.0, "shelf_id": s1},
        )
        client.post(
            "/api/books",
            json={"title": f"S-{title}", "width_mm": 30.0, "height_mm": 200.0, "shelf_id": s2_b},
        )

    # 1. Balanced mode across all bookcases populates both Despacho and Salón (doesn't leave Salón empty!)
    bal = client.post(
        "/api/organization/preview",
        json={"pack_mode": "balanced", "sort_rules": [{"field": "title", "direction": "asc"}]},
    ).json()
    bc2_after_books = sum(len(s["books"]) for s in bal["after_bookcases"][1]["shelves"])
    assert bc2_after_books > 0

    # 2. per_bookcase + only_occupied_shelves keeps Salón's 4 books sorted right inside Salón Balda 2
    per_bc = client.post(
        "/api/organization/preview",
        json={
            "pack_mode": "per_bookcase",
            "only_occupied_shelves": True,
            "sort_rules": [{"field": "title", "direction": "asc"}],
        },
    ).json()
    salon_shelves = per_bc["after_bookcases"][1]["shelves"]
    assert len(salon_shelves[0]["books"]) == 0  # Balda 1 stayed empty
    assert [b["title"] for b in salon_shelves[1]["books"]] == ["S-Alfa", "S-Beta", "S-Gamma", "S-Zeta"]
    assert s2_a != s2_b
