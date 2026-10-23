"""The contract review PDF: rendered on the server from the client's review, no LLM calls."""

import unicodedata
from urllib.parse import unquote

import pymupdf
from fastapi.testclient import TestClient

from app.accounts import config
from app.main import app

client = TestClient(app)

TK = "Трудовой кодекс Республики Казахстан"
REVIEW = {
    "filename": "Договор_Иванов.docx",
    "counts": {"violation": 1, "disputed": 0, "ok": 1, "unchecked": 0},
    "clauses": [
        {"clause_number": "3.3", "text": "Испытательный срок <b>шесть</b> месяцев.", "verdict": "violation",
         "explanation": "Не больше трёх месяцев.", "fix": "Испытательный срок три месяца.",
         "norms": [{"citation": f"{TK}, Статья 36, Пункт 2", "text": "не может превышать трех месяцев"}], "verified": True},
        {"clause_number": "9.1", "text": "Договор вступает в силу с момента подписания.", "verdict": "ok",
         "explanation": "", "fix": None, "norms": [], "verified": None},
    ],
    "truncated": False,
    "disclaimer": "QorgauAI — информационный помощник, а не юрист.",
}


def test_pdf_downloads_with_real_cyrillic_text():
    resp = client.post("/reports/contract-review", json=REVIEW)
    assert resp.status_code == 200 and resp.headers["content-type"] == "application/pdf"
    disposition = resp.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert unquote(disposition.split("filename*=UTF-8''")[1]) == "Проверка договора — Договор_Иванов.pdf"
    doc = pymupdf.open(stream=resp.content, filetype="pdf")
    text = "".join(page.get_text() for page in doc)
    for expected in ("Нарушения", "Пункт 3.3", "ТК ст. 36, п. 2", "Испытательный срок три месяца", "Без нарушений", "9.1"):
        assert expected in text
    assert "<b>шесть</b>" in text  # contract text is escaped, not rendered as HTML
    assert len(resp.content) < 300_000  # the font is subset, not embedded whole


def test_pdf_needs_sign_in_and_a_valid_review(monkeypatch):
    bad = {**REVIEW, "clauses": [{**REVIEW["clauses"][0], "verdict": "maybe"}]}
    assert client.post("/reports/contract-review", json=bad).status_code == 422
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    assert client.post("/reports/contract-review", json=REVIEW).status_code == 401


def test_pdf_speaks_the_chosen_language(monkeypatch):
    from app.agents.translate import ArticleTranslation
    from app.api import routes

    async def fake(code, number, title, chapter, points, lang):
        return ArticleTranslation(title=title, chapter=chapter, points=[f"<{lang}> {p}" for p in points])

    monkeypatch.setattr(routes, "translate_article", fake)
    for lang, expected in (("en", ("Violations", "Clause 3.3", "LC art. 36, p. 2", "How to fix it:")),
                           ("kk", ("Бұзушылықтар", "3.3-тармақ", "ЕК 36-бап, 2-тармақ", "Қалай түзету керек:", "Неліктен."))):
        resp = client.post("/reports/contract-review", json={**REVIEW, "lang": lang})
        # NFKC: the Ubuntu font sets Latin "fi" as one ligature glyph in the text layer.
        text = unicodedata.normalize("NFKC", "".join(page.get_text() for page in pymupdf.open(stream=resp.content, filetype="pdf")))
        for phrase in expected:
            assert phrase in text, (lang, phrase)
        assert "Испытательный срок три месяца" in text  # the contract wording stays as written
        assert f"<{lang}>" in text  # the quoted norm comes from the translated article
