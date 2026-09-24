"""LLM-as-judge for the golden dataset: correctness against the reference
answer, faithfulness of claims to the cited norms, forbidden claims and
per-clause verdicts for contract reviews."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.agents.config import _node
from app.agents.llm import parse
from app.guardrails.untrusted import wrap_untrusted
from app.retrieval.search import get_article

PROMPT = (Path(__file__).parent / "judge.md").read_text(encoding="utf-8")

# gpt-5.4 at t=0 rather than gpt-5.5: the whole eval had a $7 budget, and all
# three pipelines share the gpt-5.4 generator, so any self-preference bias
# applies to A, B and C equally and cancels out in the comparison.
JUDGE = _node("JUDGE", "gpt-5.4", 0.0, None, 1500, "gpt-5.4-mini")

MAX_SOURCE_CHARS = 2500

CODE_KEYS = {"Трудовой кодекс": "labor_code", "Конституция": "constitution"}
CALCULATOR_PREFIX = "Калькулятор отпуска по нормам: "


class VerdictCheck(BaseModel):
    clause_number: str
    matched: bool


class Judgement(BaseModel):
    correctness: Literal["correct", "partial", "incorrect"]
    correctness_reason: str
    claims_total: int
    claims_unsupported: list[str]
    must_not_claim_violated: bool
    verdicts: list[VerdictCheck]


def expand_citation(citation: str) -> list[str]:
    """The calculator cites all the norms it applied in one string."""
    if citation.startswith(CALCULATOR_PREFIX):
        return citation[len(CALCULATOR_PREFIX):].split("; ")
    return [citation]


def parse_law_citation(citation: str) -> tuple[str, str, str] | None:
    """'Трудовой кодекс Республики Казахстан, Статья 89, Пункт 1' -> ('labor_code', '89', 'Пункт 1')."""
    code = next((key for prefix, key in CODE_KEYS.items() if citation.startswith(prefix)), None)
    m = re.search(r"Статья\s+([\w.\-]+)", citation)
    if code is None or m is None:
        return None
    return code, m.group(1), citation[m.end():].lstrip(", ").strip()


@lru_cache(maxsize=512)
def _article_points(code: str, number: str) -> tuple[tuple[str, str], ...]:
    return tuple((c.point, c.text) for c in get_article(code, number))


def source_text(citation: str, document_evidence: dict[str, str]) -> str:
    if citation in document_evidence:
        return document_evidence[citation]
    texts = []
    for c in expand_citation(citation):
        parsed = parse_law_citation(c)
        if parsed is None:
            texts.append(c)
            continue
        code, number, point = parsed
        points = _article_points(code, number)
        point = point.lower()
        chosen = [t for p, t in points if point and (p.lower() == point or p.lower().startswith(point + ","))]
        texts.append("\n".join(chosen or [t for _, t in points])[:MAX_SOURCE_CHARS])
    return "\n".join(texts)


async def judge(item: dict, final: dict, *, document_evidence: dict[str, str], expected_verdicts: list[dict]) -> Judgement:
    claims = final.get("claims") or []
    answer = "\n".join(f"- {c['text']}" for c in claims) or final.get("answer", "")
    sources = "\n\n".join(
        wrap_untrusted("source", f"{c}\n{source_text(c, document_evidence)}") for c in final.get("sources") or []
    ) or "(помощник ни на что не сослался)"
    verdicts = "\n".join(f"- пункт {v['clause_number']}: {v['verdict']} ({v['reason']})" for v in expected_verdicts) or "(нет)"
    forbidden = "\n".join(f"- {x}" for x in item.get("must_not_claim") or []) or "(нет)"
    content = (
        f"Вопрос:\n{item['question']}\n\n"
        f"Эталонный ответ:\n{item['expected_answer']}\n\n"
        f"Ответ помощника:\n{wrap_untrusted('answer', answer)}\n\n"
        f"Тексты, на которые сослался помощник:\n{sources}\n\n"
        f"Запрещённые утверждения:\n{forbidden}\n\n"
        f"Эталонные вердикты по пунктам договора:\n{verdicts}"
    )
    return await parse(JUDGE, [{"role": "system", "content": PROMPT}, {"role": "user", "content": content}], Judgement, name="judge-answer")
