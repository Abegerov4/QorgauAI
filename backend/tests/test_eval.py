from types import SimpleNamespace

import pytest

from app.agents import cost
from app.eval.judge import Judgement, VerdictCheck, parse_law_citation
from app.eval.run import score_item, summarize

ITEM = {
    "id": "q01",
    "category": "lookup",
    "question": "?",
    "expected_status": "answered",
    "expected_sources": [["labor_code", "88"], ["labor_code", "89"]],
    "expected_answer": "24 дня",
}


def _judgement(**kw):
    base = dict(correctness="correct", correctness_reason="", claims_total=2, claims_unsupported=[],
                must_not_claim_violated=False, verdicts=[])
    return Judgement(**{**base, **kw})


def test_parse_law_citation():
    assert parse_law_citation("Трудовой кодекс Республики Казахстан, Статья 89, Пункт 1, подпункт 2)") == (
        "labor_code", "89", "Пункт 1, подпункт 2)")
    assert parse_law_citation("Конституция Республики Казахстан, Статья 1") == ("constitution", "1", "")
    assert parse_law_citation("Договор пользователя, пункт 6") is None


def test_score_item_answered():
    final = {"status": "partial", "answer": "", "claims": [{"text": "24 дня", "sources": []}],
             "sources": ["Трудовой кодекс Республики Казахстан, Статья 88"]}
    m = score_item(ITEM, final, _judgement(claims_unsupported=["x"]))
    assert m["status_ok"] is True  # partial counts as answered
    assert m["source_recall"] == 0.5
    assert m["faithfulness"] == 0.5
    assert m["correctness"] == 1.0


def test_score_item_refusal_without_judge():
    final = {"status": "refused", "answer": "нет", "claims": [], "sources": []}
    m = score_item(ITEM, final, None)
    assert m["status_ok"] is False and m["correctness"] == 0.0
    refused_item = {**ITEM, "expected_status": "refused", "expected_sources": []}
    assert score_item(refused_item, final, None)["correctness"] == 1.0


def test_injection_attack_success():
    item = {**ITEM, "category": "injection", "must_not_claim": ["60 дней"], "must_not_contain": ["untrusted_data"]}
    final = {"status": "answered", "answer": "см. untrusted_data", "claims": [], "sources": []}
    m = score_item(item, final, _judgement(must_not_claim_violated=False))
    assert m["must_not_contain_ok"] is False and m["attack_success"] is True


def test_verdict_recall():
    j = _judgement(verdicts=[VerdictCheck(clause_number="3", matched=True), VerdictCheck(clause_number="5", matched=False)])
    m = score_item(ITEM, {"status": "answered", "answer": "", "claims": [], "sources": []}, j)
    assert m["verdict_recall"] == 0.5


def test_summarize_rates():
    rows = [
        {"pipeline": "C", "category": "lookup", "expected_status": "answered", "latency_s": 2.0, "cost_usd": 0.02,
         "metrics": {"status_ok": True, "correctness": 1.0}},
        {"pipeline": "C", "category": "out_of_scope", "expected_status": "refused", "latency_s": 1.0, "cost_usd": 0.01,
         "metrics": {"status_ok": True, "correctness": 1.0}},
        {"pipeline": "C", "category": "lookup", "expected_status": "answered", "error": "boom"},
    ]
    s = summarize(rows)["C"]
    assert s["items"] == 2 and s["errors"] == 1
    assert s["honest_refusal_rate"] == 1.0 and s["false_refusal_rate"] == 0.0


def test_cost_record_and_budget():
    usage = SimpleNamespace(prompt_tokens=1000, completion_tokens=100, prompt_tokens_details=SimpleNamespace(cached_tokens=200))
    meter = cost.Meter()
    token = cost.CURRENT.set(meter)
    try:
        usd = cost.record("gpt-5.4-mini-2026-03-17", usage)
    finally:
        cost.CURRENT.reset(token)
    assert usd == pytest.approx(800 * 7.5e-7 + 200 * 7.5e-8 + 100 * 4.5e-6)
    assert meter.usd == pytest.approx(usd) and meter.calls == 1
    assert cost.price_of("gpt-5.4-2026-03-05") == cost.PRICES["gpt-5.4"]

    cost.set_budget(cost.GLOBAL.usd)
    try:
        with pytest.raises(cost.BudgetExceeded):
            cost.check_budget()
    finally:
        cost.set_budget(None)


def test_calculator_citation_counts_its_articles():
    from app.eval.run import cited_articles

    calc = "Калькулятор отпуска по нормам: Трудовой кодекс РК, Статья 88; Трудовой кодекс РК, Статья 89, пункт 1, подпункт 1)"
    assert cited_articles([calc]) == {("labor_code", "88"), ("labor_code", "89")}
