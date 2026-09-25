"""
Pipeline C: agentic RAG on LangGraph (doc sections 4, 8, 12.1).

    guard_input -> research -+-> generate -> verify -+-> finalize
                             |                       |
                             +-> finalize (refusal)  +-> rewrite_query -> research  (at most MAX_RETRIES)

Routing is decided by plain Python (`route_after_research`,
`route_after_verify`), never by the LLM. The final answer is assembled only
from claims the Verifier confirmed, so every sentence the user sees carries a
citation by construction.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from pathlib import Path
from typing import Any, TypedDict

import openai
from langfuse import observe, propagate_attributes
from langgraph.graph import END, START, StateGraph

from app.agents import config
from app.agents.llm import chat, parse
from app.agents.schemas import AnswerClaim, Draft, FinalAnswer, ResearchSummary, Verification
from app.agents.toolbox import LegalToolbox
from app.guardrails.pii import mask_pii
from app.guardrails.untrusted import wrap_untrusted
from app.observability import langfuse

PROMPTS_DIR = Path(__file__).parent / "prompts"
PROMPTS = {name: (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8") for name in ("research", "generate", "verify")}

FINISH_TOOL = openai.pydantic_function_tool(
    ResearchSummary,
    name="finish_research",
    description="Заверши исследование: найденных норм достаточно, тема вне корпуса или поиск больше ничего не даёт.",
)

DISCLAIMER = (
    "QorgauAI — информационный помощник, а не юрист. Ответ основан только на процитированных нормах "
    "Конституции и Трудового кодекса РК; для спорной ситуации обратитесь к практикующему юристу."
)


class AgentState(TypedDict, total=False):
    question: str  # PII-masked
    pii_masked: bool
    research_messages: list[dict]  # kept across the retry so the planner remembers what it already tried
    evidence: list[dict]  # {"id", "citation", "text", "tool"}
    summary: dict | None
    attempt: int
    feedback: str | None
    draft: dict | None
    verification: dict | None
    final: dict | None
    path: list[str]  # nodes visited, for the UI and evals
    document_block: str | None  # uploaded document clauses, PII-masked, already wrapped as untrusted
    max_research_steps: int
    tool_log: list[dict]  # {"name", "args", "found", "result", "attempt"}: what the planner did, for the UI


# Live progress for /ask/stream. answer_question sets the callback; LangGraph
# runs nodes as asyncio tasks, which inherit the context, so nodes can report
# without the callback travelling through the state.
_ON_EVENT: ContextVar[Callable[[dict], Awaitable[None]] | None] = ContextVar("on_event", default=None)


async def _emit(event: dict) -> None:
    if (callback := _ON_EVENT.get()) is not None:
        await callback(event)


# --------------------------------------------------------------------- nodes


@observe(name="guard-input", as_type="guardrail", capture_input=False, capture_output=False)
async def guard_input(state: AgentState) -> AgentState:
    await _emit({"type": "step", "node": "guard_input"})
    masked, mapping = mask_pii(state["question"])
    langfuse.update_current_span(
        input={"question": state["question"]},  # masked again at export
        output={"question": masked, "pii_found": sorted({k.strip("[]").rsplit("_", 1)[0] for k in mapping})},
    )
    return {
        "question": masked,
        "pii_masked": bool(mapping),
        "attempt": 0,
        "evidence": list(state.get("evidence") or []),  # uploaded document clauses (D-ids), if any
        "path": ["guard_input"],
        "tool_log": [],
    }


def _evidence_from_tool(name: str, payload: Any) -> list[dict]:
    if name == "search_legal_corpus" and isinstance(payload, list):
        return [{"citation": r["citation"], "text": r["text"], "tool": name} for r in payload]
    if name == "get_article" and isinstance(payload, dict) and payload.get("found"):
        return [{"citation": p["citation"], "text": p["text"], "tool": name} for p in payload["points"]]
    if name == "calculate_vacation_days" and isinstance(payload, dict):
        text = "; ".join(payload["breakdown"]) + f". Итого: {payload['total_days']} календарных дней."
        if payload.get("note"):
            text += " " + payload["note"]
        return [{"citation": "Калькулятор отпуска по нормам: " + "; ".join(payload["citations"]), "text": text, "tool": name}]
    return []


def _log_entry(name: str, args: dict, payload: Any, attempt: int) -> dict:
    """One tool call as the UI shows it: what was asked and which norms came back."""
    found: list[str] = []
    result = None
    if name == "search_legal_corpus" and isinstance(payload, list):
        found = [r["citation"] for r in payload]
    elif name == "get_article" and isinstance(payload, dict) and payload.get("found") and payload.get("points"):
        found = [re.sub(r",\s*Пункт.*$", "", payload["points"][0]["citation"])]  # the article, not its first point
    elif name == "calculate_vacation_days" and isinstance(payload, dict):
        found = list(payload.get("citations") or [])
        result = f"{payload['total_days']} календарных дней"
    return {"name": name, "args": args, "found": list(dict.fromkeys(found)), "result": result, "attempt": attempt}


def _merge_evidence(existing: list[dict], new: list[dict]) -> list[dict]:
    seen = {(e["citation"], e["text"]) for e in existing}
    merged = list(existing)
    law_count = sum(1 for e in existing if e["id"].startswith("E"))
    for e in new:
        key = (e["citation"], e["text"])
        if key not in seen:
            seen.add(key)
            law_count += 1
            merged.append({**e, "id": f"E{law_count}"})
    return merged


def _hide_rerank(tool: dict) -> dict:
    fn = tool["function"]
    if fn["name"] != "search_legal_corpus":
        return tool
    params = {**fn["parameters"], "properties": {k: v for k, v in fn["parameters"]["properties"].items() if k != "rerank"}}
    return {**tool, "function": {**fn, "parameters": params}}


def make_research(toolbox: LegalToolbox):
    tools = [*(_hide_rerank(t) for t in toolbox.openai_tools()), FINISH_TOOL]

    @observe(name="research", as_type="agent", capture_input=False, capture_output=False)
    async def research(state: AgentState) -> AgentState:
        await _emit({"type": "step", "node": "research"})
        messages = list(state.get("research_messages") or [])
        if not messages:
            user_msg = "Вопрос пользователя:\n" + wrap_untrusted("user", state["question"])
            if state.get("document_block"):
                user_msg += "\n\nЗагруженный пользователем документ:\n<document>\n" + state["document_block"] + "\n</document>"
            messages = [
                {"role": "system", "content": PROMPTS["research"]},
                {"role": "user", "content": user_msg},
            ]
        else:
            messages.append({"role": "user", "content": state["feedback"]})
        langfuse.update_current_span(input={"question": state["question"], "attempt": state["attempt"], "feedback": state.get("feedback")})

        evidence = list(state.get("evidence") or [])
        tool_log = list(state.get("tool_log") or [])
        summary: ResearchSummary | None = None
        max_steps = state.get("max_research_steps") or config.MAX_RESEARCH_STEPS
        for step in range(max_steps + 1):
            # Last iteration: force the planner to wrap up instead of searching forever.
            force_finish = step == max_steps
            resp = await chat(
                config.RESEARCH,
                messages,
                name="plan-research-step",
                tools=tools,
                tool_choice={"type": "function", "function": {"name": "finish_research"}} if force_finish else "required",
            )
            msg = resp.choices[0].message
            messages.append(msg.model_dump(exclude_none=True, include={"role", "content", "tool_calls"}))
            for call in msg.tool_calls or []:
                args = json.loads(call.function.arguments or "{}")
                if call.function.name == "finish_research":
                    summary = ResearchSummary.model_validate(args)
                    result_text = "ok"
                else:
                    shown_args = dict(args)
                    if call.function.name == "search_legal_corpus":
                        args["rerank"] = config.RERANK
                    raw, is_error = await toolbox.call(call.function.name, args)
                    payload = None
                    if not is_error:
                        try:
                            payload = json.loads(raw)
                            evidence = _merge_evidence(evidence, _evidence_from_tool(call.function.name, payload))
                        except json.JSONDecodeError:
                            pass
                    entry = _log_entry(call.function.name, shown_args, payload, state["attempt"])
                    tool_log.append(entry)
                    await _emit({"type": "tool", **entry})
                    result_text = wrap_untrusted(f"tool:{call.function.name}", raw)
                messages.append({"role": "tool", "tool_call_id": call.id, "content": result_text})
            if summary is not None:
                break

        langfuse.update_current_span(
            output={"summary": summary.model_dump() if summary else None, "evidence": [f"{e['id']}: {e['citation']}" for e in evidence]}
        )
        return {
            "research_messages": messages,
            "evidence": evidence,
            "summary": summary.model_dump() if summary else None,
            "tool_log": tool_log,
            "path": [*state["path"], "research"],
        }

    return research


def _evidence_block(evidence: list[dict]) -> str:
    return "\n".join(wrap_untrusted(e["id"], f"[{e['id']}] {e['citation']}\n{e['text']}") for e in evidence)


@observe(name="generate-answer", as_type="agent", capture_input=False, capture_output=False)
async def generate(state: AgentState) -> AgentState:
    await _emit({"type": "step", "node": "generate"})
    evidence = state["evidence"]
    missing = (state.get("summary") or {}).get("missing_info") or []
    langfuse.update_current_span(input={"question": state["question"], "evidence_ids": [e["id"] for e in evidence]})
    draft = await parse(
        config.GENERATOR,
        [
            {"role": "system", "content": PROMPTS["generate"]},
            {
                "role": "user",
                "content": (
                    f"<evidence>\n{_evidence_block(evidence)}\n</evidence>\n\n"
                    f"Вопрос пользователя:\n{wrap_untrusted('user', state['question'])}\n\n"
                    f"Исследователь отметил, что может не хватать: {missing or 'ничего'}"
                ),
            },
        ],
        Draft,
        name="write-draft",
    )
    langfuse.update_current_span(output=draft.model_dump())
    return {"draft": draft.model_dump(), "path": [*state["path"], "generate"]}


@observe(name="verify-claims", as_type="agent", capture_input=False, capture_output=False)
async def verify(state: AgentState) -> AgentState:
    await _emit({"type": "step", "node": "verify"})
    evidence_ids = {e["id"] for e in state["evidence"]}
    claims = state["draft"]["claims"]
    claims_block = "\n".join(
        f"{i}. {c['text']} (опирается на: {', '.join(c['evidence_ids']) or 'ничего'})" for i, c in enumerate(claims)
    )
    langfuse.update_current_span(input={"claims": [c["text"] for c in claims]})
    result = await parse(
        config.VERIFIER,
        [
            {"role": "system", "content": PROMPTS["verify"]},
            {"role": "user", "content": f"<evidence>\n{_evidence_block(state['evidence'])}\n</evidence>\n\nУтверждения:\n{claims_block}"},
        ],
        Verification,
        name="check-citations",
    )
    by_index = {c.claim_index: c for c in result.checks}
    checks = []
    for i, claim in enumerate(claims):
        check = by_index.get(i)
        # Code critic on top of the LLM critic: a claim citing no evidence, or
        # an id that doesn't exist, is unsupported no matter what the LLM said.
        cited_ok = bool(claim["evidence_ids"]) and set(claim["evidence_ids"]) <= evidence_ids
        supported = bool(check and check.supported and cited_ok)
        explanation = check.explanation if check else "Verifier не вернул проверку для этого утверждения."
        if not cited_ok:
            explanation = "Утверждение ссылается на несуществующие или пустые фрагменты."
        checks.append({"claim_index": i, "supported": supported, "confidence": check.confidence if check else 0.0, "explanation": explanation})
    all_supported = all(c["supported"] for c in checks)
    langfuse.update_current_span(output={"all_supported": all_supported, "checks": checks})
    await _emit({"type": "verified", "checked": len(checks), "supported": sum(c["supported"] for c in checks)})
    return {"verification": {"checks": checks, "all_supported": all_supported}, "path": [*state["path"], "verify"]}


@observe(name="rewrite-query", as_type="span", capture_input=False, capture_output=False)
async def rewrite_query(state: AgentState) -> AgentState:
    await _emit({"type": "step", "node": "rewrite_query"})
    claims = state["draft"]["claims"]
    failed = [
        f"- «{claims[c['claim_index']]['text']}» — {c['explanation']}"
        for c in state["verification"]["checks"]
        if not c["supported"]
    ]
    feedback = (
        "Проверка показала, что эти утверждения не подтверждены найденными нормами:\n"
        + "\n".join(failed)
        + "\nНайди нормы, которые их подтверждают или опровергают, другими юридическими формулировками. "
        "Затем вызови finish_research."
    )
    langfuse.update_current_span(input={"unsupported": len(failed)}, output={"feedback": feedback})
    return {"feedback": feedback, "attempt": state["attempt"] + 1, "path": [*state["path"], "rewrite_query"]}


@observe(name="finalize-answer", as_type="span", capture_input=False, capture_output=False)
async def finalize(state: AgentState) -> AgentState:
    await _emit({"type": "step", "node": "finalize"})
    summary = state.get("summary") or {}
    evidence = {e["id"]: e for e in state.get("evidence") or []}
    draft = state.get("draft")
    missing = list((draft or {}).get("missing_info") or summary.get("missing_info") or [])

    if not draft:
        reason = (
            "Этот вопрос вне тем, которые покрывает QorgauAI: сейчас в базе только Конституция и Трудовой кодекс Республики Казахстан."
            if summary and not summary.get("in_scope", True)
            else "В доступных текстах Конституции и Трудового кодекса РК не нашлось нормы, которая отвечает на этот вопрос."
        )
        final = FinalAnswer(status="refused", answer=reason, claims=[], sources=[], missing_info=missing,
                            removed_claims=[], recommend_lawyer=False, disclaimer=DISCLAIMER)
    else:
        checks = {c["claim_index"]: c for c in state["verification"]["checks"]}
        kept, removed = [], []
        for i, claim in enumerate(draft["claims"]):
            if checks.get(i, {}).get("supported"):
                kept.append(AnswerClaim(text=claim["text"], sources=[evidence[x]["citation"] for x in claim["evidence_ids"]]))
            else:
                removed.append(claim["text"])
        sources = list(dict.fromkeys(s for c in kept for s in c.sources))
        if kept:
            status = "answered" if not removed else "partial"
            answer = " ".join(c.text for c in kept)
        else:
            status = "refused"
            answer = "Не удалось подтвердить ответ нормами Конституции и Трудового кодекса РК, поэтому я не буду его давать."
        final = FinalAnswer(status=status, answer=answer, claims=kept, sources=sources, missing_info=missing,
                            removed_claims=removed, recommend_lawyer=bool(draft["recommend_lawyer"]), disclaimer=DISCLAIMER)

    langfuse.update_current_span(output=final.model_dump())
    return {"final": final.model_dump(), "path": [*state["path"], "finalize"]}


# ------------------------------------------------------------------- routing


def route_after_research(state: AgentState) -> str:
    summary = state.get("summary") or {}
    has_law = any(e["id"].startswith("E") for e in state.get("evidence") or [])
    if not summary.get("in_scope", True) or not has_law:
        return "finalize"  # an uploaded contract alone can't justify a legal answer
    return "generate"


def route_after_verify(state: AgentState) -> str:
    if state["verification"]["all_supported"]:
        return "finalize"
    if state["attempt"] < config.MAX_RETRIES:
        return "rewrite_query"
    return "finalize"


def build_graph(toolbox: LegalToolbox):
    g = StateGraph(AgentState)
    g.add_node("guard_input", guard_input)
    g.add_node("research", make_research(toolbox))
    g.add_node("generate", generate)
    g.add_node("verify", verify)
    g.add_node("rewrite_query", rewrite_query)
    g.add_node("finalize", finalize)

    g.add_edge(START, "guard_input")
    g.add_edge("guard_input", "research")
    g.add_conditional_edges("research", route_after_research, {"generate": "generate", "finalize": "finalize"})
    g.add_edge("generate", "verify")
    g.add_conditional_edges("verify", route_after_verify, {"finalize": "finalize", "rewrite_query": "rewrite_query"})
    g.add_edge("rewrite_query", "research")
    g.add_edge("finalize", END)
    return g.compile()


async def answer_question(
    graph,
    question: str,
    *,
    document=None,
    session_id: str | None = None,
    tags: list[str] | None = None,
    on_event: Callable[[dict], Awaitable[None]] | None = None,
    user_id: str | None = None,
) -> dict:
    """Run pipeline C as one Langfuse trace. Returns the final state.

    `document` is an IngestedDocument: its clauses enter the graph as
    evidence items D<n>, so claims about the contract are cited and verified
    exactly like claims about the law.

    `on_event` receives live progress: {"type": "step", "node"} when a node
    starts and {"type": "tool", ...} after each MCP tool call."""
    with langfuse.start_as_current_observation(
        as_type="agent", name="answer-question", input={"question": question}
    ) as root, propagate_attributes(
        trace_name="answer-question",
        session_id=session_id,
        user_id=user_id,
        tags=["pipeline:C", *(["document"] if document else []), *(tags or [])],
        metadata={
            "research_model": config.RESEARCH.model,
            "generator_model": config.GENERATOR.model,
            "generator_temperature": str(config.GENERATOR.temperature),
            "verifier_model": config.VERIFIER.model,
        },
    ):
        initial: AgentState = {"question": question}
        if document is not None:
            initial["evidence"] = list(document.evidence)
            initial["document_block"] = "\n".join(
                wrap_untrusted(e["id"], f"[{e['id']}] {e['citation']}: {e['text']}") for e in document.evidence
            )
            initial["max_research_steps"] = config.MAX_RESEARCH_STEPS_DOCUMENT
        token = _ON_EVENT.set(on_event)
        try:
            state = await graph.ainvoke(initial)
        finally:
            _ON_EVENT.reset(token)
        final = state["final"]
        root.update(
            output={"status": final["status"], "answer": final["answer"], "sources": final["sources"]},
            metadata={"path": state["path"], "attempts": state.get("attempt", 0) + 1, "evidence": len(state.get("evidence") or [])},
        )
        # The web app attaches the user's 👍/👎 to this trace.
        state["trace_id"] = langfuse.get_current_trace_id()
    return state
