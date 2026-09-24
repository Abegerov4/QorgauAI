from app.ingestion.parse_corpus import _chunk_type


def test_chunk_type():
    assert _chunk_type("исключен Законом РК от 19.04.2023 № 223-VII", "Подпункт 3)") == "repealed"
    assert _chunk_type("трудовые;", "Пункт 1, подпункт 1)") == "fragment"
    assert _chunk_type("Основной оплачиваемый ежегодный трудовой отпуск предоставляется ...", "Пункт 1") == "norm"
    assert _chunk_type("Основной оплачиваемый ежегодный трудовой отпуск предоставляется ...", "") == "article_full"
