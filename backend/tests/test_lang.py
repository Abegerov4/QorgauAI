"""Answer language: Russian prompts stay exactly as they were, Kazakh and
English get one extra instruction, fixed texts follow the language -- no API calls."""

import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.agents import graph, lang, review
from app.agents.review import ReviewDraft
from app.agents.schemas import ClaimCheck, Draft, DraftClaim, Verification
from app.ingestion.documents import Clause
from app.main import app

client = TestClient(app)
EVIDENCE = [{"id": "E1", "citation": "Трудовой кодекс Республики Казахстан, Статья 88", "text": "двадцать четыре дня"}]


def _state(**kw):
    return {"question": "q", "attempt": 0, "evidence": EVIDENCE, "path": [], **kw}


def test_russian_adds_nothing_to_the_prompts():
    assert lang.answer_note("ru") == lang.verify_note("ru") == lang.review_note("ru") == lang.research_note("ru") == ""
    assert "английском" in lang.answer_note("en") and "казахском" in lang.answer_note("kk")
    assert "только по-русски" in lang.research_note("kk")


@pytest.mark.parametrize("code", ["ru", "kk", "en"])
def test_generate_and_verify_send_the_note_only_for_other_languages(monkeypatch, code):
    monkeypatch.setattr(graph, "langfuse", MagicMock())
    sent = []

    async def fake_parse(node, messages, schema, *, name):
        sent.append(messages[1]["content"])
        if schema is Draft:
            return Draft(claims=[DraftClaim(text="24 days", evidence_ids=["E1"])], missing_info=[], recommend_lawyer=False, follow_up_questions=[])
        return Verification(checks=[ClaimCheck(claim_index=0, supported=True, confidence=1, explanation="ok")])

    monkeypatch.setattr(graph, "parse", fake_parse)
    draft = asyncio.run(graph.generate(_state(lang=code)))["draft"]
    asyncio.run(graph.verify(_state(lang=code, draft=draft)))
    if code == "ru":
        assert not any("Язык ответа" in m or "Утверждения написаны" in m for m in sent)
    else:
        assert "Язык ответа" in sent[0] and "Утверждения написаны" in sent[1]


@pytest.mark.parametrize("code", ["ru", "kk", "en"])
def test_refusal_and_disclaimer_follow_the_language(monkeypatch, code):
    monkeypatch.setattr(graph, "langfuse", MagicMock())
    out = asyncio.run(graph.finalize(_state(lang=code, summary={"in_scope": False})))["final"]
    assert out["status"] == "refused"
    assert out["answer"] == lang.text("out_of_scope", code)
    assert out["disclaimer"] == lang.text("disclaimer", code)


def test_review_texts_follow_the_language():
    clauses = [Clause(clause_number="1.1", topic="other", text="Договор вступает в силу.")]
    rows = review.settle(clauses, ReviewDraft(verdicts=[]), {}, [], "en")
    assert rows[0]["verdict"] == "unchecked" and rows[0]["explanation"] == lang.text("no_verdict", "en")


def test_api_rejects_an_unknown_language():
    assert client.post("/ask", json={"question": "q", "lang": "de"}).status_code == 422


def test_article_is_translated_for_other_languages(monkeypatch):
    from app.agents.translate import ArticleTranslation
    from app.api import routes

    async def fake(code, number, title, chapter, points, lang):
        return ArticleTranslation(title=f"Article {number}", chapter="Chapter", points=[f"[{lang}] {p[:10]}" for p in points])

    monkeypatch.setattr(routes, "translate_article", fake)
    ru = client.get("/articles/labor_code/88").json()
    en = client.get("/articles/labor_code/88?lang=en").json()
    assert ru["translated"] is False and en["translated"] is True
    assert en["article"] == "Article 88" and len(en["points"]) == len(ru["points"])
    assert en["points"][0]["point"] == ru["points"][0]["point"]  # point labels stay raw for matching citations


def test_article_falls_back_to_russian_when_translation_fails(monkeypatch):
    from app.api import routes

    async def broken(*a, **k):
        return None

    monkeypatch.setattr(routes, "translate_article", broken)
    body = client.get("/articles/labor_code/88?lang=kk").json()
    assert body["translated"] is False and "Статья 88" in body["article"]
