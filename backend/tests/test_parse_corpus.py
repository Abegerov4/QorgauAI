import json

import pytest

from app.ingestion import parse_corpus
from app.ingestion.parse_corpus import _chunk_type


def test_chunk_type():
    assert _chunk_type("исключен Законом РК от 19.04.2023 № 223-VII", "Подпункт 3)") == "repealed"
    assert _chunk_type("трудовые;", "Пункт 1, подпункт 1)") == "fragment"
    assert _chunk_type("Основной оплачиваемый ежегодный трудовой отпуск предоставляется ...", "Пункт 1") == "norm"
    assert _chunk_type("Основной оплачиваемый ежегодный трудовой отпуск предоставляется ...", "") == "article_full"


def test_parser_rejects_unfilled_revision(monkeypatch, tmp_path):
    (tmp_path / "meta.json").write_text(json.dumps({
        "labor_code": {"source_note": "adilet.zan.kz, редакция от <впишите дату с сайта>"},
    }))
    monkeypatch.setattr(parse_corpus, "RAW_DIR", tmp_path)
    with pytest.raises(ValueError, match="Unfilled source_note"):
        parse_corpus.load_source_note("labor_code")
