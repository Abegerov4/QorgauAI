from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["qdrant_connected"] is True


def test_vacation_days_endpoint():
    resp = client.post("/tools/vacation-days", json={"hazardous_work": True})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_days"] == 30
    assert len(body["citations"]) == 2


def test_vacation_days_rejects_negative_bonus():
    resp = client.post("/tools/vacation-days", json={"employer_bonus_days": -1})
    assert resp.status_code == 422


def test_ask_without_lifespan_returns_503():
    # TestClient used without `with` never runs lifespan, so no MCP session/graph.
    resp = client.post("/ask", json={"question": "test"})
    assert resp.status_code == 503


def test_search_without_openai_key_returns_503(monkeypatch):
    monkeypatch.setattr("app.retrieval.embeddings.OPENAI_API_KEY", None)
    resp = client.post("/search", json={"query": "test"})
    assert resp.status_code == 503


def test_article_endpoint():
    resp = client.get("/articles/labor_code/88")
    assert resp.status_code == 200
    body = resp.json()
    assert body["article_number"] == "88"
    assert body["points"]


def test_article_unknown_code_returns_404():
    assert client.get("/articles/civil_code/1").status_code == 404
