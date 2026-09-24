"""Document ingestion logic that must hold without calling any model."""

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agents import graph
from app.ingestion import documents
from app.ingestion.documents import Clause, DocumentFindings, UnsupportedDocument, detect_kind

TEST_DOCS = Path(__file__).resolve().parents[1] / "data" / "test_docs"


def test_detect_kind_by_magic_bytes_not_extension():
    assert detect_kind((TEST_DOCS / "contract_text.pdf").read_bytes()) == "pdf"
    assert detect_kind((TEST_DOCS / "contract_scan.jpg").read_bytes()) == "jpeg"
    assert detect_kind(b"\x89PNG\r\n\x1a\n...") == "png"
    with pytest.raises(UnsupportedDocument):
        detect_kind(b"MZ\x90\x00 not a document")


def test_text_pdf_never_calls_vision(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("vision must not be called for a page with a text layer")

    monkeypatch.setattr(documents, "transcribe_image", boom)
    pages = asyncio.run(documents.read_pages((TEST_DOCS / "contract_text.pdf").read_bytes()))
    assert [(p.page, p.method) for p in pages] == [(1, "text_layer")]
    assert "испытательный срок" in pages[0].text


def test_scanned_pdf_goes_to_vision(monkeypatch):
    calls = []

    async def fake_ocr(image, mime, page):
        calls.append((mime, page))
        return "1. Текст пункта"

    monkeypatch.setattr(documents, "transcribe_image", fake_ocr)
    pages = asyncio.run(documents.read_pages((TEST_DOCS / "contract_scan.pdf").read_bytes()))
    assert [(p.page, p.method) for p in pages] == [(1, "vision")]
    assert calls == [("image/png", 1)]


def test_normalize_clause_text():
    c = documents._normalize(Clause(clause_number="5", topic="wage_payment", text="5. Заработная\nплата  раз в квартал."))
    assert c.text == "Заработная плата раз в квартал."


def test_ingest_masks_pii_and_builds_document_evidence(monkeypatch):
    async def fake_parse(node, messages, response_format, *, name):
        assert "870512300456" not in messages[1]["content"]  # extractor only ever sees masked text
        return DocumentFindings(
            document_type="employment_contract",
            clauses=[Clause(clause_number="6", topic="vacation_days", text="6. Отпуск 18 календарных дней.")],
        )

    monkeypatch.setattr(documents, "parse", fake_parse)
    doc = asyncio.run(documents.ingest_document((TEST_DOCS / "contract_text.pdf").read_bytes(), "c.pdf"))
    assert "870512300456" not in doc.text and "870512300456" not in doc.pages[0].text
    assert set(doc.pii_found) == {"IIN", "PHONE", "IBAN"}
    assert doc.evidence == [
        {"id": "D6", "citation": "Договор пользователя, пункт 6", "text": "Отпуск 18 календарных дней.", "tool": "document"}
    ]
    assert documents.DOCUMENTS[doc.id] is doc


def test_law_evidence_numbering_ignores_document_items():
    existing = [{"id": "D3", "citation": "Договор, пункт 3", "text": "6 месяцев", "tool": "document"}]
    merged = graph._merge_evidence(existing, [{"citation": "ТК, Статья 36, Пункт 2", "text": "не более трёх месяцев", "tool": "s"}])
    assert [e["id"] for e in merged] == ["D3", "E1"]


def test_document_alone_is_not_enough_to_answer():
    state = {"summary": {"in_scope": True}, "evidence": [{"id": "D3", "citation": "c", "text": "t"}]}
    assert graph.route_after_research(state) == "finalize"


def test_upload_rejects_unsupported_file():
    from app.main import app

    resp = TestClient(app).post("/documents", files={"file": ("x.pdf", b"not really a pdf", "application/pdf")})
    assert resp.status_code == 415
