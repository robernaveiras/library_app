from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import Base, create_sqlite_engine, get_db
from app.main import app
from app.routers import tags as tags_router
from app.services.ai_providers import AIProvider, ScanAnalysisResult


class FakeCategorizerAI(AIProvider):
    provider_id = "gemini"
    model = "gemini-2.5-flash"

    async def analyze_shelf_image(self, *args, **kwargs) -> ScanAnalysisResult:
        raise NotImplementedError

    async def complete_json(self, system_prompt: str, user_prompt: str):
        if "Criterio del usuario:" in user_prompt:
            return {
                "matches": [
                    {
                        "book_id": 2,
                        "confidence": 0.98,
                        "reason": "Ursula K. Le Guin es una autora mujer.",
                    }
                ]
            }
        return {
            "books": [
                {
                    "book_id": 1,
                    "genre": "Ciencia ficción",
                    "subgenre": "Space opera",
                    "series_name": "Dune",
                    "series_index": 1,
                    "is_fiction": True,
                    "author_gender": "hombre",
                    "author_region": "Estados Unidos",
                },
                {
                    "book_id": 2,
                    "genre": "Ciencia ficción",
                    "subgenre": "Ciencia ficción antropológica",
                    "series_name": "Ciclo de Hainish",
                    "series_index": 4,
                    "is_fiction": True,
                    "author_gender": "mujer",
                    "author_region": "Estados Unidos",
                },
            ]
        }


def make_test_client(tmp_path):
    db_file = tmp_path / "test_tags.db"
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


def test_tags_crud_manual_assign_and_ai_rule_evaluation(tmp_path, monkeypatch):
    monkeypatch.setattr(tags_router, "get_ai_provider", lambda **_kwargs: FakeCategorizerAI())
    client = make_test_client(tmp_path)

    b1 = client.post("/api/books", json={"title": "Dune", "authors": ["Frank Herbert"]}).json()
    b2 = client.post(
        "/api/books",
        json={"title": "La mano izquierda de la oscuridad", "authors": ["Ursula K. Le Guin"]},
    ).json()

    # 1. AI batch categorization
    cat_res = client.post(
        "/api/books/categorize-ai",
        json={"provider": "gemini", "only_missing": True},
    )
    assert cat_res.status_code == 200
    cat_body = cat_res.json()
    assert cat_body["updated"] == 2
    assert cat_body["genres_summary"]["Ciencia ficción"] == 2

    b2_after = client.get(f"/api/books/{b2['id']}").json()
    assert b2_after["genre"] == "Ciencia ficción"
    assert b2_after["series_name"] == "Ciclo de Hainish"
    assert b2_after["extra_attributes"]["author_gender"] == "mujer"

    # 2. Create custom tag with natural language AI rule
    tag_resp = client.post(
        "/api/tags",
        json={
            "name": "Escritos por mujeres",
            "description": "Libros de autoras mujeres",
            "color_hex": "#9d174d",
            "ai_rule_prompt": "Libros escritos por mujeres",
        },
    )
    assert tag_resp.status_code == 201
    tag = tag_resp.json()

    # Duplicate tag name rejected (case-insensitive)
    dup = client.post("/api/tags", json={"name": "escritos por mujeres"})
    assert dup.status_code == 409

    # 3. Evaluate rule with AI (human-in-the-loop preview mode)
    eval_resp = client.post(
        f"/api/tags/{tag['id']}/evaluate",
        json={"provider": "gemini", "auto_apply": False},
    )
    assert eval_resp.status_code == 200
    ev = eval_resp.json()
    assert ev["evaluated_books"] == 2
    assert len(ev["proposals"]) == 1
    assert ev["proposals"][0]["book_id"] == b2["id"]
    assert ev["proposals"][0]["already_assigned"] is False

    # 4. Confirm and assign selected proposal
    assign_resp = client.post(
        f"/api/tags/{tag['id']}/assign",
        json={"add_book_ids": [b2["id"]], "source": "ai_confirmed"},
    )
    assert assign_resp.status_code == 200
    assert assign_resp.json()["book_count"] == 1

    # Filter books by tag_id
    filtered = client.get("/api/books", params={"tag_id": tag["id"]}).json()
    assert [b["id"] for b in filtered] == [b2["id"]]

    # Set tags directly on book b1 and verify
    set_resp = client.put(f"/api/books/{b1['id']}/tags", json={"tag_ids": [tag["id"]]})
    assert set_resp.status_code == 200
    assert len(set_resp.json()["tags"]) == 1

    # Delete tag cascades cleanly
    assert client.delete(f"/api/tags/{tag['id']}").status_code == 204
    assert client.get(f"/api/books/{b2['id']}").json()["tags"] == []
