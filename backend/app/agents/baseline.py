"""Pipelines A and B of the A/B/C benchmark (doc section 9): classic one-shot
RAG with no planner and no verifier.

A: dense retrieval -> one generator call.
B: hybrid retrieval (dense + BM25, RRF) -> one generator call.

Same generator model and settings as pipeline C, so the comparison isolates
retrieval (A vs B) and the agentic loop (B vs C)."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from langfuse import observe, propagate_attributes
from pydantic import BaseModel, Field

from app.agents import config
from app.agents.llm import parse
from app.guardrails.pii import mask_pii
from app.guardrails.untrusted import wrap_untrusted
from app.observability import langfuse
from app.retrieval.search import dense_only_search, hybrid_search

PROMPT = (Path(__file__).parent / "prompts" / "baseline.md").read_text(encoding="utf-8")
TOP_K = 5

Pipeline = Literal["A", "B"]


class BaselineAnswer(BaseModel):
    status: Literal["answered", "refused"]
    answer: str
    evidence_ids: list[str] = Field(description="Номера фрагментов, на которые опирается ответ, например ['E1', 'D3'].")


@observe(name="generate-baseline", as_type="chain", capture_input=False)
async def _generate(question: str, evidence: list[dict]) -> BaselineAnswer:
    block = "\n".join(wrap_untrusted(e["id"], f"[{e['id']}] {e['citation']}\n{e['text']}") for e in evidence)
    return await parse(
        config.GENERATOR,
        [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": f"<evidence>\n{block}\n</evidence>\n\nВопрос пользователя:\n{wrap_untrusted('user', question)}"},
        ],
        BaselineAnswer,
        name="write-baseline-answer",
    )


async def answer_baseline(pipeline: Pipeline, question: str, *, document=None, tags: list[str] | None = None) -> dict:
    """Returns a dict shaped like pipeline C's FinalAnswer (status, answer,
    claims, sources) so the eval scores all three the same way."""
    masked, _ = mask_pii(question)
    search = dense_only_search if pipeline == "A" else hybrid_search
    with langfuse.start_as_current_observation(
        as_type="chain", name="answer-baseline", input={"question": masked}
    ) as root, propagate_attributes(
        trace_name="answer-baseline",
        tags=[f"pipeline:{pipeline}", *(["document"] if document else []), *(tags or [])],
        metadata={"generator_model": config.GENERATOR.model, "generator_temperature": str(config.GENERATOR.temperature)},
    ):
        chunks = search(masked, top_k=TOP_K)
        evidence = [{"id": f"E{i}", "citation": c.citation, "text": c.text} for i, c in enumerate(chunks, 1)]
        if document is not None:
            evidence = [*document.evidence, *evidence]
        result = await _generate(masked, evidence)
        by_id = {e["id"]: e["citation"] for e in evidence}
        sources = list(dict.fromkeys(by_id[i] for i in result.evidence_ids if i in by_id))
        final = {
            "status": result.status,
            "answer": result.answer,
            "claims": [{"text": result.answer, "sources": sources}] if result.status == "answered" else [],
            "sources": sources if result.status == "answered" else [],
            "missing_info": [],
            "removed_claims": [],
        }
        root.update(output={"status": final["status"], "answer": final["answer"], "sources": final["sources"]})
    return final
