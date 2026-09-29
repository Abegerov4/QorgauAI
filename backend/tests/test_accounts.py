"""Sign-in, roles, daily limits, feedback, history and the admin summary --
all against a throwaway SQLite database, no LLM calls."""

import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.accounts import config, db, service
from app.accounts.auth import User
from app.main import app

client = TestClient(app)


def token(email: str, *, secret: str = "test-secret", exp: float | None = None, name: str = "Test") -> dict:
    claims = {"sub": email, "name": name, "iss": config.JWT_ISSUER, "aud": config.JWT_AUDIENCE, "exp": exp or time.time() + 600}
    return {"Authorization": "Bearer " + jwt.encode(claims, secret, algorithm="HS256")}


USER = User("user@example.com", "User", "user")
ADMIN = User("admin@example.com", "Admin", "admin")


def test_local_mode_needs_no_sign_in():
    body = client.get("/me").json()
    assert body["email"] == config.LOCAL_USER_EMAIL and body["role"] == "admin"


def test_sign_in_required_when_enabled(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    assert client.get("/me").status_code == 401
    body = client.get("/me", headers=token("User@Example.com")).json()
    assert (body["email"], body["role"], body["daily_limit"]) == ("user@example.com", "user", 3)
    assert client.get("/me", headers=token("admin@example.com")).json()["role"] == "admin"


@pytest.mark.parametrize(
    "headers",
    [
        token("user@example.com", secret="wrong-secret"),
        token("user@example.com", exp=time.time() - 10),
        {"Authorization": "Bearer not-a-jwt"},
    ],
)
def test_bad_tokens_are_rejected(monkeypatch, headers):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    assert client.get("/me", headers=headers).status_code == 401


def test_daily_quota_per_user_and_global_budget():
    for _ in range(3):
        service.log_question(USER, "вопрос", "answered", None, 0.01)
    with pytest.raises(Exception) as e:
        service.check_quota(USER)
    assert e.value.status_code == 429 and "3 вопросов" in e.value.detail
    service.check_quota(ADMIN)  # admins are only capped by the budget
    service.log_question(ADMIN, "дорогой вопрос", "answered", None, 1.0)
    with pytest.raises(Exception) as e:
        service.check_quota(ADMIN)
    assert e.value.status_code == 429 and "бюджет" in e.value.detail


def test_question_log_masks_pii():
    service.log_question(USER, "Мой ИИН 900101300123, какой отпуск?", "answered", "t1", 0.02)
    stats = service.admin_summary(lambda t: None)
    assert stats["today"]["users"] == [{"email": USER.email, "questions": 1, "cost_usd": 0.02}]
    from sqlalchemy import select

    from app.accounts import db

    with db.engine().connect() as conn:
        stored = conn.execute(select(db.questions.c.question)).scalar_one()
    assert "900101300123" not in stored


def test_feedback_only_on_own_answers_and_second_vote_replaces(monkeypatch):
    scores = []
    monkeypatch.setattr("app.api.routes.langfuse.create_score", lambda **kw: scores.append(kw))
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    service.log_question(USER, "вопрос", "answered", "trace-1", 0.02)

    other = client.post("/feedback", json={"trace_id": "trace-1", "helpful": True}, headers=token("admin@example.com"))
    assert other.status_code == 404  # not their answer

    headers = token(USER.email)
    assert client.post("/feedback", json={"trace_id": "trace-1", "helpful": True}, headers=headers).status_code == 204
    assert client.post("/feedback", json={"trace_id": "trace-1", "helpful": False, "comment": "не та статья"}, headers=headers).status_code == 204
    assert [s["value"] for s in scores] == [1, 0] and scores[-1]["name"] == "user_feedback"

    stats = client.get("/admin/stats", headers=token("admin@example.com")).json()
    assert (stats["week"]["helpful"], stats["week"]["not_helpful"]) == (0, 1)
    assert stats["negative_feedback"][0]["comment"] == "не та статья"
    assert stats["negative_feedback"][0]["question"] == "вопрос"


def test_admin_stats_is_admin_only(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    assert client.get("/admin/stats", headers=token(USER.email)).status_code == 403


def test_chats_round_trip_list_and_delete(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    headers = token(USER.email)
    assert client.get("/chats", headers=headers).json() == []
    chat = {"sessionId": "web-1", "items": [{"id": "1", "kind": "question", "text": "вопрос"}], "clauses": []}
    assert client.put("/chats/web-1", json={"title": "вопрос", "chat": chat}, headers=headers).status_code == 204
    assert client.put("/chats/web-2", json={"title": "второй", "chat": chat}, headers=headers).status_code == 204
    assert [c["title"] for c in client.get("/chats", headers=headers).json()] == ["второй", "вопрос"]  # newest first
    assert client.put("/chats/web-1", json={"title": "вопрос", "chat": chat}, headers=headers).status_code == 204
    assert [c["id"] for c in client.get("/chats", headers=headers).json()] == ["web-1", "web-2"]  # saving bumps it
    assert client.get("/chats/web-1", headers=headers).json() == {"id": "web-1", "title": "вопрос", "chat": chat}
    assert client.delete("/chats/web-2", headers=headers).status_code == 204
    assert [c["id"] for c in client.get("/chats", headers=headers).json()] == ["web-1"]
    assert client.get("/chats/web-2", headers=headers).status_code == 404


def test_chats_are_private_and_limited(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    chat = {"sessionId": "web-1", "items": [], "clauses": []}
    client.put("/chats/web-1", json={"title": "мой", "chat": chat}, headers=token(USER.email))
    other = token("admin@example.com")
    assert client.get("/chats", headers=other).json() == []
    assert client.get("/chats/web-1", headers=other).status_code == 404
    assert client.put("/chats/web-1", json={"title": "чужой", "chat": chat}, headers=other).status_code == 404
    client.delete("/chats/web-1", headers=other)  # a no-op for someone else's chat
    assert client.get("/chats/web-1", headers=token(USER.email)).json()["title"] == "мой"
    assert client.get("/chats/bad%20id", headers=other).status_code == 422
    monkeypatch.setattr(config, "MAX_HISTORY_BYTES", 100)
    big = {**chat, "items": [{"text": "x" * 200}]}
    assert client.put("/chats/web-3", json={"title": "big", "chat": big}, headers=other).status_code == 413


def test_legacy_single_chat_moves_into_conversations(tmp_path):
    from sqlalchemy import create_engine, inspect

    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    with create_engine(url).begin() as conn:
        db.legacy_chats.create(conn)
        chat = {"sessionId": "web-old", "items": [{"id": "1", "kind": "question", "text": "Старый вопрос"}], "clauses": []}
        conn.execute(db.legacy_chats.insert().values(user_email=USER.email, items=chat, updated_at=db.now()))
    db.reset_engine(url)  # runs init_db and the migration
    assert not inspect(db.engine()).has_table("chats")
    assert service.list_chats(USER)[0]["title"] == "Старый вопрос"
    assert service.load_chat(USER, "web-old")["chat"] == chat


def test_quota_blocks_the_agent_before_it_runs(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    monkeypatch.setattr(app.state, "graph", object(), raising=False)
    called = []

    async def fake_answer(*a, **kw):
        called.append(1)

    monkeypatch.setattr("app.api.routes.answer_question", fake_answer)
    for _ in range(3):
        service.log_question(USER, "вопрос", "answered", None, 0.0)
    resp = client.post("/ask/stream", json={"question": "ещё"}, headers=token(USER.email))
    assert resp.status_code == 429 and called == []


def test_admin_users_list_detail_and_votes(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    client.get("/me", headers=token(USER.email, name="Айгерим"))
    service.log_question(USER, "Мой ИИН 900101300123, отпуск?", "answered", "t1", 0.02)
    service.log_question(USER, "второй", "refused", "t2", 0.01)
    service.save_feedback(USER, "t1", 0, "не то")
    assert client.get("/admin/users", headers=token(USER.email, name="Айгерим")).status_code == 403

    body = client.get("/admin/users", headers=token(ADMIN.email)).json()
    assert body["default_limit"] == 3
    row = next(u for u in body["users"] if u["email"] == USER.email)
    assert (row["name"], row["questions"], row["questions_today"], row["cost_usd"]) == ("Айгерим", 2, 2, 0.03)
    assert (row["helpful"], row["not_helpful"], row["blocked"], row["question_limit"]) == (0, 1, False, 3)

    detail = client.get(f"/admin/users/{USER.email.upper()}", headers=token(ADMIN.email)).json()
    by_status = {q["status"]: q for q in detail["questions"]}
    assert "900101300123" not in by_status["answered"]["question"]
    assert (by_status["answered"]["helpful"], by_status["answered"]["comment"]) == (False, "не то")
    assert by_status["refused"]["helpful"] is None
    assert client.get("/admin/users/nobody@example.com", headers=token(ADMIN.email)).status_code == 404


def test_admin_sets_a_personal_limit(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    client.get("/me", headers=token(USER.email))
    for _ in range(3):
        service.log_question(USER, "вопрос", "answered", None, 0.0)
    assert client.patch(f"/admin/users/{USER.email}", json={"daily_limit": 0}, headers=token(ADMIN.email)).status_code == 422
    row = client.patch(f"/admin/users/{USER.email}", json={"daily_limit": 5}, headers=token(ADMIN.email)).json()
    assert (row["daily_limit"], row["question_limit"]) == (5, 5)
    assert client.get("/me", headers=token(USER.email)).json()["daily_limit"] == 5
    user = User(USER.email, USER.name, "user", 5)
    service.check_quota(user)  # 3 of 5
    # null resets to the default, which is used up
    row = client.patch(f"/admin/users/{USER.email}", json={"daily_limit": None}, headers=token(ADMIN.email)).json()
    assert (row["daily_limit"], row["question_limit"]) == (None, 3)
    with pytest.raises(Exception) as e:
        service.check_quota(User(USER.email, USER.name, "user", None))
    assert e.value.status_code == 429


def test_blocked_user_is_locked_out_but_admin_cannot_be_blocked(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    client.get("/me", headers=token(USER.email))
    client.get("/me", headers=token(ADMIN.email))
    assert client.patch(f"/admin/users/{USER.email}", json={"blocked": True}, headers=token(ADMIN.email)).json()["blocked"]
    resp = client.get("/me", headers=token(USER.email))
    assert resp.status_code == 403 and "ограничен" in resp.json()["detail"]
    assert client.get("/chats", headers=token(USER.email)).status_code == 403
    assert client.patch(f"/admin/users/{USER.email}", json={"blocked": False}, headers=token(ADMIN.email)).status_code == 200
    assert client.get("/me", headers=token(USER.email)).status_code == 200
    assert client.patch(f"/admin/users/{ADMIN.email}", json={"blocked": True}, headers=token(ADMIN.email)).status_code == 400
    assert client.patch(f"/admin/users/{USER.email}", json={"blocked": None}, headers=token(ADMIN.email)).status_code == 422


def test_tables_from_before_later_columns_get_them(tmp_path):
    from sqlalchemy import Column, DateTime, MetaData, String, Table, create_engine, inspect

    url = f"sqlite:///{tmp_path / 'old.db'}"
    old = Table("users", MetaData(), Column("email", String(320), primary_key=True), Column("name", String(200)),
                Column("created_at", DateTime(), nullable=False), Column("last_seen_at", DateTime(), nullable=False))
    with create_engine(url).begin() as conn:
        old.create(conn)
        conn.execute(old.insert().values(email=USER.email, name="Old", created_at=db.now(), last_seen_at=db.now()))
    old_chats = Table("conversations", MetaData(), Column("id", String(64), primary_key=True))
    with create_engine(url).begin() as conn:
        old_chats.create(conn)
    db.reset_engine(url)
    assert {"blocked", "daily_limit"} <= {c["name"] for c in inspect(db.engine()).get_columns("users")}
    assert "renamed" in {c["name"] for c in inspect(db.engine()).get_columns("conversations")}
    row = service.admin_users(USER.email)[0]
    assert (row["blocked"], row["daily_limit"], row["question_limit"]) == (False, None, 3)


def test_renamed_chat_keeps_its_title_on_later_saves(monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    headers = token(USER.email)
    chat = {"sessionId": "web-r", "items": [], "clauses": []}
    assert client.put("/chats/web-r", json={"title": "Первый вопрос", "chat": chat}, headers=headers).status_code == 204
    assert client.patch("/chats/web-r", json={"title": "  Отпуск  "}, headers=headers).status_code == 204
    assert client.put("/chats/web-r", json={"title": "Первый вопрос", "chat": chat}, headers=headers).status_code == 204
    assert [c["title"] for c in client.get("/chats", headers=headers).json()] == ["Отпуск"]
    assert client.patch("/chats/web-r", json={"title": "   "}, headers=headers).status_code == 422
    # someone else's chat looks missing
    assert client.patch("/chats/web-r", json={"title": "Чужой"}, headers=token(ADMIN.email)).status_code == 404
