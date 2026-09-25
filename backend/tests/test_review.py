"""Colour-coded contract review: what the code guarantees whatever the LLMs
say, the event stream, access rules and Word uploads -- no API calls."""

import asyncio
import io
import json
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from app.accounts import config
from app.agents import review
from app.agents.review import ClauseVerdict, ReviewDraft, ReviewVerification, VerdictCheck
from app.ingestion import documents
from app.ingestion.documents import Clause, DocumentFindings, IngestedDocument, UnsupportedDocument
from app.main import app

client = TestClient(app)
CONTRACTS = Path(__file__).resolve().parents[1] / "data" / "eval" / "contracts"

CLAUSES = [
    Clause(clause_number="3.3", topic="probation", text="Испытательный срок шесть месяцев."),
    Clause(clause_number="8.1", topic="vacation_days", text="Отпуск 14 календарных дней."),
    Clause(clause_number="10.2", topic="termination", text="Работник предупреждает за два месяца."),
    Clause(clause_number="11.1", topic="other", text="Договор составлен в двух экземплярах."),
]
EVIDENCE = [
    {"id": "E1", "citation": "Трудовой кодекс Республики Казахстан, Статья 36, Пункт 2", "text": "не может превышать три месяца"},
    {"id": "E2", "citation": "Трудовой кодекс Республики Казахстан, Статья 88", "text": "двадцать четыре календарных дня"},
]


def _v(n, verdict, ids=(), fix=None):
    return ClauseVerdict(clause_number=n, verdict=verdict, evidence_ids=list(ids), explanation=f"why {n}", fix=fix)


def test_settle_never_shows_red_without_a_confirmed_norm():
    draft = ReviewDraft(verdicts=[
        _v("3.3", "violation", ["E1"], fix="Три месяца."),  # confirmed: stays red
        _v("8.1", "violation", ["E2"], fix="24 дня."),  # verifier says no: becomes yellow
        _v("10.2", "violation", ["E9"]),  # cites a norm that does not exist: yellow
        # 11.1 skipped by the reviewer: grey, never green
    ])
    checks = {
        "3.3": VerdictCheck(clause_number="3.3", supported=True, explanation="ok"),
        "8.1": VerdictCheck(clause_number="8.1", supported=False, explanation="норма про другое"),
        "10.2": VerdictCheck(clause_number="10.2", supported=True, explanation="ok"),
    }
    rows = {r["clause_number"]: r for r in review.settle(CLAUSES, draft, checks, EVIDENCE)}
    assert rows["3.3"]["verdict"] == "violation" and rows["3.3"]["verified"] is True
    assert rows["3.3"]["norms"] == [{"citation": EVIDENCE[0]["citation"], "text": EVIDENCE[0]["text"]}]
    assert rows["8.1"]["verdict"] == "disputed" and rows["8.1"]["verified"] is False
    assert "норма про другое" in rows["8.1"]["explanation"] and rows["8.1"]["fix"] == "24 дня."
    assert rows["10.2"]["verdict"] == "disputed" and rows["10.2"]["norms"] == []
    assert rows["11.1"]["verdict"] == "unchecked"
    assert [r["clause_number"] for r in review.settle(CLAUSES, draft, checks, EVIDENCE)] == ["3.3", "8.1", "10.2", "11.1"]


def test_settle_keeps_green_and_drops_its_fix():
    draft = ReviewDraft(verdicts=[_v("10.2", "ok", ["E1"], fix="не нужен")])
    row = review.settle(CLAUSES[2:3], draft, {}, EVIDENCE)[0]
    assert row["verdict"] == "ok" and row["fix"] is None and row["verified"] is None


def test_section_headings_are_not_reviewed():
    clauses = [
        Clause(clause_number="3", topic="other", text="Срок договора и испытательный срок"),
        Clause(clause_number="3.1", topic="term", text="Договор заключается на неопределенный срок."),
        Clause(clause_number="6", topic="vacation_days", text="Отпуск 18 календарных дней в год, с сохранением средней заработной платы."),
    ]
    assert [c.clause_number for c in review.clauses_to_review(clauses)] == ["3.1", "6"]


def test_every_clause_gets_its_best_norm_before_the_cap(monkeypatch):
    # 40 queries, each with its own best hit and two shared ones: round robin
    # keeps all 40 best hits even though the cap is lower than 40 * 3.
    clauses = [Clause(clause_number=str(i), topic="other", text=f"Пункт договора номер {i} про условие труда") for i in range(40)]

    def fake_search(query, top_k):
        n = query.split()[3]
        return [SimpleNamespace(citation=f"best {n}", text="t"), SimpleNamespace(citation="shared A", text="t"), SimpleNamespace(citation="shared B", text="t")]

    monkeypatch.setattr(review, "hybrid_search", fake_search)
    monkeypatch.setattr(review, "get_article", lambda code, n: [])
    evidence = asyncio.run(review.find_norms(clauses))
    assert {f"best {i}" for i in range(40)} <= {e["citation"] for e in evidence}
    assert len(evidence) <= review.MAX_EVIDENCE


def _document(owner=None):
    doc = IngestedDocument(
        id="doc1",
        filename="contract.pdf",
        pages=[],
        text="",
        pii_found=[],
        findings=DocumentFindings(document_type="employment_contract", clauses=CLAUSES),
        owner=owner,
    )
    documents.DOCUMENTS[doc.id] = doc
    return doc


@pytest.fixture
def fake_llm(monkeypatch):
    queries = []

    def fake_search(query, top_k):
        queries.append(query)
        return [SimpleNamespace(citation=e["citation"], text=e["text"]) for e in EVIDENCE]

    async def fake_parse(node, messages, schema, *, name):
        if schema is ReviewDraft:
            assert "Испытательный срок шесть месяцев" in messages[1]["content"]
            return ReviewDraft(verdicts=[_v("3.3", "violation", ["E1"]), _v("8.1", "violation", ["E2"]), _v("10.2", "ok"), _v("11.1", "ok")])
        assert schema is ReviewVerification
        flagged = messages[1]["content"]
        assert "Пункт 3.3" in flagged and "Пункт 10.2" not in flagged  # only red and yellow are re-checked
        return ReviewVerification(checks=[VerdictCheck(clause_number=n, supported=True, explanation="ok") for n in ("3.3", "8.1")])

    def fake_article(code, number):
        queries.append(f"article {number}")
        return [SimpleNamespace(citation=f"Трудовой кодекс Республики Казахстан, Статья {number}", text="норма")]

    monkeypatch.setattr(review, "hybrid_search", fake_search)
    monkeypatch.setattr(review, "get_article", fake_article)
    monkeypatch.setattr(review, "parse", fake_parse)
    return queries


def test_review_streams_stages_then_every_clause(fake_llm):
    events = []

    async def on_event(e):
        events.append(e)

    result = asyncio.run(review.review_document(_document(), on_event=on_event))
    assert [e["stage"] for e in events if e["type"] == "stage"] == ["search", "review", "verify"]
    assert [e["clause_number"] for e in events if e["type"] == "clause"] == ["3.3", "8.1", "10.2", "11.1"]
    assert result["counts"] == {"violation": 2, "disputed": 0, "ok": 2, "unchecked": 0}
    # The checklist article of each topic is always fetched whole, besides the search on clause texts.
    assert {"article 36", "article 88", "article 56"} <= set(fake_llm)
    assert result["clauses"][0]["norms"][0]["citation"] == "Трудовой кодекс Республики Казахстан, Статья 36"


def _token(email):
    claims = {"sub": email, "name": "T", "iss": config.JWT_ISSUER, "aud": config.JWT_AUDIENCE, "exp": time.time() + 600}
    return {"Authorization": "Bearer " + jwt.encode(claims, "test-secret", algorithm="HS256")}


def _sse(text):
    return [(b.split("\n")[0].removeprefix("event: "), json.loads(b.split("\n")[1].removeprefix("data: "))) for b in text.strip().split("\n\n")]


def test_review_endpoint_is_only_for_the_uploader(fake_llm, monkeypatch):
    monkeypatch.setattr(config, "AUTH_REQUIRED", True)
    _document(owner="user@example.com")
    assert client.post("/documents/doc1/review", headers=_token("other@example.com")).status_code == 404
    resp = client.post("/documents/doc1/review", headers=_token("user@example.com"))
    events = _sse(resp.text)
    assert events[-1][0] == "final" and events[-1][1]["counts"]["violation"] == 2
    assert sum(name == "clause" for name, _ in events) == 4
    # Asking about someone else's document is refused the same way.
    assert client.post("/ask", json={"question": "q", "document_id": "doc1"}, headers=_token("other@example.com")).status_code in (404, 503)


def test_word_documents_are_read_without_the_vision_model(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("a .docx must not go to the vision model")

    monkeypatch.setattr(documents, "transcribe_image", boom)
    data = (CONTRACTS / "v2_gross.docx").read_bytes()
    assert documents.detect_kind(data) == "docx"
    pages = asyncio.run(documents.read_pages(data))
    assert pages[0].method == "text_layer" and "3.3. Работнику устанавливается испытательный срок" in pages[0].text


def test_a_zip_that_is_not_word_is_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", "<x/>")
    with pytest.raises(UnsupportedDocument):
        documents.detect_kind(buf.getvalue())
