from app.retrieval.rerank import rerank


def test_rerank_orders_by_relevance():
    query = "Сколько дней отпуска положено работнику?"
    candidates = [
        "Государственный язык Республики Казахстан – казахский язык.",
        "Основной оплачиваемый ежегодный трудовой отпуск работникам предоставляется продолжительностью двадцать четыре календарных дня.",
        "Принудительный труд запрещен.",
    ]
    results = rerank(query, candidates, top_k=2)
    assert len(results) == 2
    assert "двадцать четыре календарных дня" in results[0].text
    assert results[0].score > results[1].score


def test_rerank_empty_candidates():
    assert rerank("query", [], top_k=5) == []
