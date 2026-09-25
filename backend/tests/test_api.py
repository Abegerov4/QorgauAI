import json

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


def test_ask_stream_without_lifespan_returns_503():
    resp = client.post("/ask/stream", json={"question": "test"})
    assert resp.status_code == 503


def test_ask_stream_sends_progress_then_final(monkeypatch):
    final = {
        "status": "answered", "answer": "a", "claims": [], "sources": [], "missing_info": [],
        "removed_claims": [], "recommend_lawyer": False, "disclaimer": "d",
    }
    tool = {"name": "get_article", "args": {"code": "labor_code", "article_number": "88"},
            "found": ["Трудовой кодекс Республики Казахстан, Статья 88"], "result": None, "attempt": 0}

    async def fake_answer(graph, question, *, on_event, **kw):
        await on_event({"type": "step", "node": "research"})
        await on_event({"type": "tool", **tool})
        return {"final": final, "path": ["guard_input", "research", "verify", "finalize"], "attempt": 0,
                "tool_log": [tool], "verification": {"checks": [{"supported": True}, {"supported": False}]},
                "trace_id": "trace-42"}

    monkeypatch.setattr("app.api.routes.answer_question", fake_answer)
    monkeypatch.setattr(app.state, "graph", object(), raising=False)
    resp = client.post("/ask/stream", json={"question": "test"})
    assert resp.status_code == 200
    events = [block.split("\n")[0].removeprefix("event: ") for block in resp.text.strip().split("\n\n")]
    assert events == ["step", "tool", "final"]
    body = json.loads(resp.text.strip().split("\n\n")[-1].split("data: ", 1)[1])
    assert body["tool_calls"][0]["found"] == tool["found"]
    assert (body["checked_claims"], body["supported_claims"]) == (2, 1)
    assert body["trace_id"] == "trace-42"
    stats = client.get("/admin/stats").json()  # local mode: the local admin
    assert stats["today"]["users"][0]["questions"] == 1
