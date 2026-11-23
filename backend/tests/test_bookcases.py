from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import Base, create_sqlite_engine, get_db
from app.main import app


def make_test_client(tmp_path):
    db_file = tmp_path / "test_library.db"
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


def test_health_and_config_status(tmp_path):
    client = make_test_client(tmp_path)
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}

    r_cfg = client.get("/api/config/status")
    assert r_cfg.status_code == 200
    body = r_cfg.json()
    assert {p["id"] for p in body["providers"]} == {"gemini", "strata"}


def test_bookcase_and_shelf_crud_lifecycle(tmp_path):
    client = make_test_client(tmp_path)

    # Create bookcase with 3 initial shelves
    resp = client.post(
        "/api/bookcases",
        json={
            "name": "Estantería Salón",
            "location": "Salón",
            "notes": "Billy blanca",
            "initial_shelves": {
                "count": 3,
                "width_cm": 76.0,
                "height_cm": 30.0,
                "depth_cm": 28.0,
            },
        },
    )
    assert resp.status_code == 201
    bc = resp.json()
    assert bc["name"] == "Estantería Salón"
    assert len(bc["shelves"]) == 3
    assert bc["total_width_cm"] == 228.0
    assert [s["label"] for s in bc["shelves"]] == ["Balda 1", "Balda 2", "Balda 3"]

    # Add a taller bottom shelf
    resp_add = client.post(
        f"/api/bookcases/{bc['id']}/shelves",
        json={"label": "Balda inferior (gran formato)", "width_cm": 76.0, "height_cm": 40.0},
    )
    assert resp_add.status_code == 201
    new_shelf = resp_add.json()
    assert new_shelf["position_index"] == 3
    assert new_shelf["height_cm"] == 40.0

    # Update shelf dimensions
    resp_upd = client.patch(
        f"/api/shelves/{new_shelf['id']}",
        json={"height_cm": 38.5, "notes": "Cómics y libros grandes"},
    )
    assert resp_upd.status_code == 200
    assert resp_upd.json()["height_cm"] == 38.5

    # Reorder shelves (move new shelf to top)
    all_ids = [s["id"] for s in bc["shelves"]]
    reordered_ids = [new_shelf["id"], *all_ids]
    resp_reorder = client.put(
        f"/api/bookcases/{bc['id']}/shelves/reorder",
        json={"shelf_ids": reordered_ids},
    )
    assert resp_reorder.status_code == 200
    assert [s["id"] for s in resp_reorder.json()["shelves"]] == reordered_ids

    # Delete a shelf and verify position indices re-normalize
    resp_del_shelf = client.delete(f"/api/shelves/{all_ids[0]}")
    assert resp_del_shelf.status_code == 204
    bc_after = client.get(f"/api/bookcases/{bc['id']}").json()
    assert len(bc_after["shelves"]) == 3
    assert [s["position_index"] for s in bc_after["shelves"]] == [0, 1, 2]

    # Delete bookcase
    resp_del_bc = client.delete(f"/api/bookcases/{bc['id']}")
    assert resp_del_bc.status_code == 204
    assert client.get("/api/bookcases").json() == []


def test_validation_rejects_invalid_dimensions(tmp_path):
    client = make_test_client(tmp_path)
    resp = client.post(
        "/api/bookcases",
        json={
            "name": "Inválida",
            "initial_shelves": {"count": 2, "width_cm": -10, "height_cm": 30},
        },
    )
    assert resp.status_code == 422
