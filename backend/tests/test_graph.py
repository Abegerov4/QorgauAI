"""Graph logic that must hold regardless of what the LLM says -- no API calls."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agents import graph
from app.agents.schemas import ClaimCheck, Verification


def _state(**kw):
    return {"question": "q", "attempt": 0, "evidence": [], "path": [], **kw}


def test_route_after_research():
    ev = [{"id": "E1", "citation": "c", "text": "t"}]
    assert graph.route_after_research(_state(summary={"in_scope": False}, evidence=ev)) == "finalize"
    assert graph.route_after_research(_state(summary={"in_scope": True}, evidence=[])) == "finalize"
    assert graph.route_after_research(_state(summary={"in_scope": True}, evidence=ev)) == "generate"


def test_route_after_verify_retries_once():
    failed = {"all_supported": False, "checks": []}
    assert graph.route_after_verify(_state(verification={"all_supported": True}, attempt=0)) == "finalize"
    assert graph.route_after_verify(_state(verification=failed, attempt=0)) == "rewrite_query"
    assert graph.route_after_verify(_state(verification=failed, attempt=1)) == "finalize"


def test_merge_evidence_dedupes_and_keeps_ids_stable():
    a = graph._merge_evidence([], [{"citation": "ТК, Статья 88", "text": "24 дня", "tool": "s"}])
    b = graph._merge_evidence(a, [{"citation": "ТК, Статья 88", "text": "24 дня", "tool": "s"},
                                   {"citation": "ТК, Статья 92, Пункт 3", "text": "14 дней", "tool": "s"}])
    assert [e["id"] for e in b] == ["E1", "E2"]
    assert b[0] == a[0]


def test_evidence_from_each_tool():
    search = graph._evidence_from_tool("search_legal_corpus", [{"citation": "c1", "text": "t1"}])
    article = graph._evidence_from_tool("get_article", {"found": True, "points": [{"citation": "c2", "text": "t2", "point": ""}]})
    missing = graph._evidence_from_tool("get_article", {"found": False})
    calc = graph._evidence_from_tool(
        "calculate_vacation_days",
        {"breakdown": ["База: 24"], "total_days": 24, "citations": ["ТК РК, Статья 88"], "note": None},
    )
    assert search[0]["citation"] == "c1" and article[0]["citation"] == "c2" and missing == []
    assert "Итого: 24" in calc[0]["text"] and "Статья 88" in calc[0]["citation"]


def test_guard_input_masks_pii_before_any_llm_call(monkeypatch):
    telemetry = MagicMock()
    monkeypatch.setattr(graph, "langfuse", telemetry)
    out = asyncio.run(graph.guard_input({"question": "Мой ИИН 900101300123, сколько дней отпуска?"}))
    assert "900101300123" not in out["question"]
    assert out["pii_masked"] is True
    assert out["pii_types"] == ["IIN"]
    assert "900101300123" not in repr(telemetry.mock_calls)
    assert telemetry.update_current_span.call_args.kwargs["input"]["question"] == out["question"]


@pytest.mark.parametrize("question, pii_types", [
    ("ИИН 900101300123, телефон +7 (701) 123-45-67, почта ivanov@mail.kz: сколько дней отпуска?",
     ["EMAIL", "IIN", "PHONE"]),
    ("Сколько дней отпуска по статье 88?", []),
])
def test_answer_masks_before_trace_and_graph_and_keeps_guard_result(monkeypatch, question, pii_types):
    telemetry = MagicMock()
    monkeypatch.setattr(graph, "langfuse", telemetry)
    seen = []

    async def research(state):
        seen.append(state)
        return {"summary": {"in_scope": False}, "path": [*state["path"], "research"]}

    monkeypatch.setattr(graph, "make_research", lambda toolbox: research)
    compiled = graph.build_graph(None)
    invoke = AsyncMock(wraps=compiled.ainvoke)
    monkeypatch.setattr(compiled, "ainvoke", invoke)
    on_event = AsyncMock()
    result = asyncio.run(graph.answer_question(compiled, question, on_event=on_event))

    masked, mapping = graph.mask_pii(question)
    assert telemetry.start_as_current_observation.call_args.kwargs["input"] == {"question": masked}
    assert invoke.call_args.args[0]["question"] == masked
    assert seen[0]["question"] == masked
    assert result["pii_masked"] is bool(pii_types)
    assert result["pii_types"] == pii_types
    guard = telemetry.update_current_span.call_args_list[0].kwargs
    assert guard["output"]["pii_found"] == pii_types
    for raw in mapping.values():
        assert raw not in repr(telemetry.mock_calls)
        assert raw not in repr(invoke.call_args)
        assert raw not in repr(on_event.call_args_list)
    assert result["path"] == ["guard_input", "research", "finalize"]
    assert on_event.await_count == 2
    assert graph._ON_EVENT.get() is None


def test_answer_does_not_trace_raw_question_when_graph_fails(monkeypatch):
    telemetry = MagicMock()
    monkeypatch.setattr(graph, "langfuse", telemetry)
    compiled = MagicMock(ainvoke=AsyncMock(side_effect=RuntimeError("research failed")))
    with pytest.raises(RuntimeError, match="research failed"):
        asyncio.run(graph.answer_question(compiled, "ИИН 900101300123", on_event=AsyncMock()))
    assert "900101300123" not in repr(telemetry.mock_calls)
    assert "900101300123" not in repr(compiled.ainvoke.call_args)
    assert graph._ON_EVENT.get() is None


def test_verify_code_critic_overrides_llm(monkeypatch):
    async def fake_parse(*args, **kwargs):  # the LLM claims everything is supported
        return Verification(checks=[ClaimCheck(claim_index=i, supported=True, confidence=0.9, explanation="ok") for i in range(3)])

    monkeypatch.setattr(graph, "parse", fake_parse)
    state = _state(
        evidence=[{"id": "E1", "citation": "c", "text": "t"}],
        draft={"claims": [
            {"text": "валидная ссылка", "evidence_ids": ["E1"]},
            {"text": "несуществующий фрагмент", "evidence_ids": ["E9"]},
            {"text": "без ссылок", "evidence_ids": []},
        ]},
    )
    out = asyncio.run(graph.verify(state))
    assert [c["supported"] for c in out["verification"]["checks"]] == [True, False, False]
    assert out["verification"]["all_supported"] is False


def test_finalize_keeps_only_verified_claims():
    state = _state(
        summary={"in_scope": True, "missing_info": []},
        evidence=[{"id": "E1", "citation": "ТК, Статья 88", "text": "24 дня"}],
        draft={"claims": [{"text": "24 дня.", "evidence_ids": ["E1"]}, {"text": "Выдумка.", "evidence_ids": ["E1"]}],
               "missing_info": [], "recommend_lawyer": False},
        verification={"all_supported": False, "checks": [
            {"claim_index": 0, "supported": True, "confidence": 0.9, "explanation": ""},
            {"claim_index": 1, "supported": False, "confidence": 0.9, "explanation": ""},
        ]},
    )
    final = asyncio.run(graph.finalize(state))["final"]
    assert final["status"] == "partial"
    assert final["answer"] == "24 дня."
    assert final["removed_claims"] == ["Выдумка."]
    assert final["sources"] == ["ТК, Статья 88"]


def test_finalize_passes_follow_ups_only_with_an_answer():
    draft = {"claims": [{"text": "24 дня.", "evidence_ids": ["E1"]}], "missing_info": [], "recommend_lawyer": False,
             "follow_up_questions": [" А если работа вредная? ", "", "Можно ли разделить отпуск?", "Третий?", "Четвёртый?"]}
    evidence = [{"id": "E1", "citation": "ТК, Статья 88", "text": "24 дня"}]
    ok = {"all_supported": True, "checks": [{"claim_index": 0, "supported": True, "confidence": 0.9, "explanation": ""}]}
    final = asyncio.run(graph.finalize(_state(summary={"in_scope": True}, evidence=evidence, draft=draft, verification=ok)))["final"]
    assert final["follow_ups"] == ["А если работа вредная?", "Можно ли разделить отпуск?", "Третий?"]
    ok["checks"][0]["supported"] = False  # nothing confirmed: a refusal suggests nothing
    final = asyncio.run(graph.finalize(_state(summary={"in_scope": True}, evidence=evidence, draft=draft, verification=ok)))["final"]
    assert (final["status"], final["follow_ups"]) == ("refused", [])


def test_finalize_refuses_out_of_scope():
    final = asyncio.run(graph.finalize(_state(summary={"in_scope": False, "missing_info": []})))["final"]
    assert final["status"] == "refused"
    assert "вне тем" in final["answer"]
    assert final["sources"] == []


def test_log_entry_keeps_what_the_ui_shows():
    search = graph._log_entry("search_legal_corpus", {"query": "отпуск"}, [{"citation": "A"}, {"citation": "B"}, {"citation": "A"}], 0)
    assert search["found"] == ["A", "B"]
    article = graph._log_entry(
        "get_article", {"code": "labor_code", "article_number": "88"},
        {"found": True, "points": [{"citation": "Трудовой кодекс Республики Казахстан, Статья 88, Пункт 1"}]}, 1,
    )
    assert article["found"] == ["Трудовой кодекс Республики Казахстан, Статья 88"] and article["attempt"] == 1
    calc = graph._log_entry("calculate_vacation_days", {}, {"total_days": 30, "citations": ["X"], "breakdown": []}, 0)
    assert calc["result"] == "30 календарных дней" and calc["found"] == ["X"]
    assert graph._log_entry("search_legal_corpus", {"query": "q"}, None, 0)["found"] == []  # tool error


def test_nodes_report_progress_only_when_asked():
    events = []

    async def collect(e):
        events.append(e)

    async def run():
        await graph._emit({"type": "step", "node": "x"})  # no callback: nothing happens
        token = graph._ON_EVENT.set(collect)
        try:
            await graph._emit({"type": "step", "node": "y"})
        finally:
            graph._ON_EVENT.reset(token)

    asyncio.run(run())
    assert events == [{"type": "step", "node": "y"}]
