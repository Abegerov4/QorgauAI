"""
Colour-coded contract review: one verdict per clause of an uploaded contract.

    clauses -> gather norms, no LLM: the checklist article of each clause's
               topic, whole, then a hybrid search on the text of each clause
            -> reviewer: a verdict per clause citing E-ids   (one LLM call)
            -> verifier: re-checks every red and yellow verdict (one LLM call)
            -> code critic: a red verdict needs a confirmed norm, else it
               becomes yellow; a verdict citing unknown ids loses them

Green means "no conflict found with the norms retrieved", not "lawful":
the UI words it that way. The whole review is one Langfuse trace.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal

from langfuse import observe, propagate_attributes
from pydantic import BaseModel, Field

from app.agents import config
from app.agents.llm import parse
from app.guardrails.untrusted import wrap_untrusted
from app.ingestion.documents import IngestedDocument
from app.observability import langfuse
from app.retrieval.search import get_article, hybrid_search

PROMPTS_DIR = Path(__file__).parent / "prompts"
REVIEW_PROMPT = (PROMPTS_DIR / "review.md").read_text(encoding="utf-8")
VERIFY_PROMPT = (PROMPTS_DIR / "review_verify.md").read_text(encoding="utf-8")

MAX_CLAUSES = 40
MAX_EVIDENCE = 80
PER_CLAUSE_TOP_K = 3
PER_TOPIC_TOP_K = 4
SEARCH_CONCURRENCY = 6

DISCLAIMER = (
    "Проверка сравнивает пункты только с Конституцией и Трудовым кодексом РК. «Нарушений не найдено» не значит, "
    "что пункт безупречен: другие законы и обстоятельства дела не учитываются. Для спора обратитесь к юристу."
)

# A reviewer's checklist: the Labor Code article a clause of this topic is
# decided by, always included whole. Similarity search alone misses them --
# for a leave clause it ranks the one-line list item "основной оплачиваемый
# ежегодный трудовой отпуск;" (art. 87) above the 24-day minimum (art. 88).
TOPIC_ARTICLES: dict[str, tuple[str, ...]] = {
    "position": ("28",),
    "start_date": ("28",),
    "term": ("30",),
    "probation": ("36",),
    "working_hours": ("68",),
    "rest_time": ("81",),
    "overtime_pay": ("77", "78", "108"),
    "wage_amount": ("103",),
    "wage_payment": ("113",),
    "vacation_days": ("88",),
    "liability": ("115",),
    "termination": ("56",),
}
# Topics whose articles are too long to include whole: a search query instead.
TOPIC_QUERIES: dict[str, str] = {
    "duties": "основные права и обязанности работника и работодателя",
    "confidentiality": "обязанность работника не разглашать сведения, составляющие тайну",
}

Verdict = Literal["violation", "disputed", "ok"]


class ClauseVerdict(BaseModel):
    clause_number: str
    verdict: Verdict
    evidence_ids: list[str] = Field(description="E-фрагменты, из которых следует вердикт, например ['E3'].")
    explanation: str = Field(description="Одно-два предложения простым языком, с числами из пункта и нормы.")
    fix: str | None = Field(description="Законная формулировка пункта для violation/disputed, иначе null.")


class ReviewDraft(BaseModel):
    verdicts: list[ClauseVerdict]


class VerdictCheck(BaseModel):
    clause_number: str
    supported: bool
    explanation: str


class ReviewVerification(BaseModel):
    checks: list[VerdictCheck]


OnEvent = Callable[[dict], Awaitable[None]] | None


async def _emit(on_event: OnEvent, event: dict) -> None:
    if on_event is not None:
        await on_event(event)


# ------------------------------------------------------------------ retrieval


def clauses_to_review(clauses: list) -> list:
    """Without section headings: the extractor sometimes returns "3. Срок
    договора" as a clause of its own next to 3.1 and 3.2. A short clause whose
    number starts other clauses' numbers is a heading, not a condition."""
    numbers = [c.clause_number for c in clauses]

    def heading(c) -> bool:
        return len(c.text) < 60 and any(n != c.clause_number and n.startswith(c.clause_number.rstrip(".") + ".") for n in numbers)

    return [c for c in clauses if not heading(c)][:MAX_CLAUSES]


def _search_queries(clauses: list) -> list[tuple[str, int]]:
    """The text of each clause (its own best norm), then a query for the
    topics the checklist has no article for."""
    queries = [(c.text[:400], PER_CLAUSE_TOP_K) for c in clauses if len(c.text) > 20]
    topics = dict.fromkeys(c.topic for c in clauses if c.topic in TOPIC_QUERIES)
    return queries + [(TOPIC_QUERIES[t], PER_TOPIC_TOP_K) for t in topics]


@observe(name="review-search", as_type="retriever", capture_input=False, capture_output=False)
async def find_norms(clauses: list) -> list[dict]:
    """Evidence E1..En for the reviewer, deduplicated, at most MAX_EVIDENCE:
    the checklist articles first, then the search hits."""
    articles = list(dict.fromkeys(n for c in clauses for n in TOPIC_ARTICLES.get(c.topic, ())))
    queries = _search_queries(clauses)
    langfuse.update_current_span(input={"articles": articles, "queries": len(queries)})
    gate = asyncio.Semaphore(SEARCH_CONCURRENCY)

    async def run(fn, *args):
        async with gate:
            return await asyncio.to_thread(fn, *args)

    checklist = await asyncio.gather(*(run(get_article, "labor_code", n) for n in articles))
    results = await asyncio.gather(*(run(hybrid_search, q, k) for q, k in queries))
    evidence: list[dict] = []
    seen: set[str] = set()
    for hit in (h for article in checklist for h in article):
        if hit.citation not in seen and len(evidence) < MAX_EVIDENCE:
            seen.add(hit.citation)
            evidence.append({"id": f"E{len(evidence) + 1}", "citation": hit.citation, "text": hit.text})
    # Round robin over the queries: every query's best hit gets in before any
    # query's second one, so the cap never crowds out a clause's own norm.
    for rank in range(max(PER_CLAUSE_TOP_K, PER_TOPIC_TOP_K)):
        for hits in results:
            if rank >= len(hits) or len(evidence) >= MAX_EVIDENCE:
                continue
            hit = hits[rank]
            if hit.citation not in seen:
                seen.add(hit.citation)
                evidence.append({"id": f"E{len(evidence) + 1}", "citation": hit.citation, "text": hit.text})
    langfuse.update_current_span(output={"evidence": [f"{e['id']}: {e['citation']}" for e in evidence]})
    return evidence


def _evidence_block(evidence: list[dict]) -> str:
    return "\n".join(wrap_untrusted(e["id"], f"[{e['id']}] {e['citation']}\n{e['text']}") for e in evidence)


def _clauses_block(clauses: list) -> str:
    return "\n".join(wrap_untrusted(f"D{c.clause_number}", f"Пункт {c.clause_number}: {c.text}") for c in clauses)


# ------------------------------------------------------------------ LLM steps


@observe(name="review-clauses", as_type="agent", capture_input=False, capture_output=False)
async def draft_verdicts(clauses: list, evidence: list[dict]) -> ReviewDraft:
    draft = await parse(
        config.REVIEWER,
        [
            {"role": "system", "content": REVIEW_PROMPT},
            {
                "role": "user",
                "content": f"<evidence>\n{_evidence_block(evidence)}\n</evidence>\n\n<contract>\n{_clauses_block(clauses)}\n</contract>",
            },
        ],
        ReviewDraft,
        name="rule-on-clauses",
    )
    langfuse.update_current_span(output={v.clause_number: v.verdict for v in draft.verdicts})
    return draft


@observe(name="verify-verdicts", as_type="agent", capture_input=False, capture_output=False)
async def verify_verdicts(clauses: list, flagged: list[ClauseVerdict], evidence: list[dict]) -> dict[str, VerdictCheck]:
    if not flagged:
        return {}
    text = {c.clause_number: c.text for c in clauses}
    listing = "\n".join(
        f"- Пункт {v.clause_number} ({v.verdict}): «{text.get(v.clause_number, '')}». "
        f"Вывод: {v.explanation} (опирается на: {', '.join(v.evidence_ids) or 'ничего'})"
        for v in flagged
    )
    result = await parse(
        config.VERIFIER,
        [
            {"role": "system", "content": VERIFY_PROMPT},
            {"role": "user", "content": f"<evidence>\n{_evidence_block(evidence)}\n</evidence>\n\nВердикты:\n{wrap_untrusted('verdicts', listing)}"},
        ],
        ReviewVerification,
        name="check-verdicts",
    )
    checks = {c.clause_number: c for c in result.checks}
    langfuse.update_current_span(output={n: c.supported for n, c in checks.items()})
    return checks


# ------------------------------------------------------------------ assembly


def settle(clauses: list, draft: ReviewDraft, checks: dict[str, VerdictCheck], evidence: list[dict]) -> list[dict]:
    """The code critic: what the UI shows for every clause, whatever the LLMs said.

    - a clause the reviewer skipped is "unchecked" (grey), never green;
    - evidence ids that do not exist are dropped;
    - red needs a cited norm the verifier confirmed, otherwise it is yellow;
    - yellow the verifier did not confirm stays yellow, marked unverified."""
    by_id = {e["id"]: e for e in evidence}
    by_clause = {v.clause_number: v for v in draft.verdicts}
    out = []
    for c in clauses:
        v = by_clause.get(c.clause_number)
        if v is None:
            out.append(_row(c, "unchecked", "Модель не вынесла вердикт по этому пункту — проверьте его сами.", None, [], None))
            continue
        ids = [i for i in dict.fromkeys(v.evidence_ids) if i in by_id]
        norms = [{"citation": by_id[i]["citation"], "text": by_id[i]["text"]} for i in ids]
        if v.verdict == "ok":
            out.append(_row(c, "ok", v.explanation, None, norms, None))
            continue
        check = checks.get(c.clause_number)
        confirmed = bool(ids) and check is not None and check.supported
        verdict: str = v.verdict
        explanation = v.explanation
        if v.verdict == "violation" and not confirmed:
            verdict = "disputed"
            reason = check.explanation if check and ids else "вывод не подкреплён найденной нормой."
            explanation = f"{v.explanation} Проверяющий не подтвердил нарушение: {reason}"
        out.append(_row(c, verdict, explanation, v.fix, norms, confirmed))
    return out


def _row(clause, verdict: str, explanation: str, fix: str | None, norms: list[dict], verified: bool | None) -> dict:
    return {
        "clause_number": clause.clause_number,
        "topic": clause.topic,
        "text": clause.text,
        "verdict": verdict,
        "explanation": explanation,
        "fix": fix if verdict in ("violation", "disputed") else None,
        "norms": norms,
        "verified": verified,
    }


async def review_document(
    document: IngestedDocument,
    *,
    on_event: OnEvent = None,
    user_id: str | None = None,
    session_id: str | None = None,
) -> dict:
    """Review every clause of an uploaded contract. Streams {"type": "stage"}
    while it works and {"type": "clause"} per clause once the verdicts are
    final; returns the whole review."""
    clauses = clauses_to_review(document.findings.clauses)
    with langfuse.start_as_current_observation(
        as_type="agent", name="review-contract", input={"document_id": document.id, "clauses": len(clauses)}
    ) as root, propagate_attributes(
        trace_name="review-contract",
        session_id=session_id,
        user_id=user_id,
        tags=["review", "document"],
        metadata={"reviewer_model": config.REVIEWER.model, "verifier_model": config.VERIFIER.model},
    ):
        await _emit(on_event, {"type": "stage", "stage": "search", "clauses": len(clauses)})
        evidence = await find_norms(clauses)
        await _emit(on_event, {"type": "stage", "stage": "review", "norms": len(evidence)})
        draft = await draft_verdicts(clauses, evidence)
        flagged = [v for v in draft.verdicts if v.verdict != "ok"]
        await _emit(on_event, {"type": "stage", "stage": "verify", "flagged": len(flagged)})
        checks = await verify_verdicts(clauses, flagged, evidence)
        rows = settle(clauses, draft, checks, evidence)
        for row in rows:
            await _emit(on_event, {"type": "clause", **row})
        counts = {k: sum(r["verdict"] == k for r in rows) for k in ("violation", "disputed", "ok", "unchecked")}
        review = {
            "document_id": document.id,
            "filename": document.filename,
            "counts": counts,
            "clauses": rows,
            "truncated": len(clauses) == MAX_CLAUSES and len(document.findings.clauses) > MAX_CLAUSES,
            "disclaimer": DISCLAIMER,
            "trace_id": langfuse.get_current_trace_id(),
        }
        root.update(output={"counts": counts})
    return review
