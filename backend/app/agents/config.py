"""Per-node model settings (doc section 12.6). Every value can be overridden
via env vars, so A/B experiments swap models/temperatures without code edits."""

from __future__ import annotations

import os
from dataclasses import dataclass

from app.retrieval import config as _retrieval_config  # noqa: F401  -- loads backend/.env


@dataclass(frozen=True)
class NodeModel:
    model: str
    temperature: float | None  # None: model doesn't accept it (gpt-5.5 -> HTTP 400)
    reasoning_effort: str | None
    max_completion_tokens: int
    fallbacks: tuple[str, ...]
    timeout: float = 40.0  # seconds per attempt
    retries: int = 1  # SDK retries of the same model before the fallback


def _node(
    prefix: str,
    model: str,
    temperature: float | None,
    reasoning_effort: str | None,
    max_tokens: int,
    fallbacks: str,
    *,
    timeout: float = 40.0,
    retries: int = 1,
) -> NodeModel:
    t = os.environ.get(f"{prefix}_TEMPERATURE")
    return NodeModel(
        model=os.environ.get(f"{prefix}_MODEL", model),
        temperature=(None if t == "none" else float(t)) if t is not None else temperature,
        reasoning_effort=os.environ.get(f"{prefix}_REASONING_EFFORT", reasoning_effort),
        max_completion_tokens=int(os.environ.get(f"{prefix}_MAX_TOKENS", max_tokens)),
        fallbacks=tuple(m for m in os.environ.get(f"{prefix}_FALLBACKS", fallbacks).split(",") if m),
        timeout=float(os.environ.get(f"{prefix}_TIMEOUT", timeout)),
        retries=int(os.environ.get(f"{prefix}_RETRIES", retries)),
    )


RESEARCH = _node("RESEARCH", "gpt-5.4-mini", 0.0, None, 1500, "gpt-5.4")
GENERATOR = _node("GENERATOR", "gpt-5.4", 0.0, None, 2000, "gpt-5.4-mini")
VERIFIER = _node("VERIFIER", "gpt-5.5", None, "low", 2000, "gpt-5.4")

# Document ingestion (doc section 12.3): OCR of scans/photos needs a vision
# model; turning text into structured clauses is cheap extraction work.
VISION = _node("VISION", "gpt-5.4", 0.0, None, 4000, "gpt-5.5")
EXTRACTOR = _node("EXTRACTOR", "gpt-5.4-mini", 0.0, None, 3000, "gpt-5.4")

# Contract review (colour-coded verdict per clause): one call rules on every
# clause at once, so it needs a larger output budget than an answer. That
# output takes over a minute on a 20-clause contract: with the default 40 s
# the call timed out twice and the review fell back to gpt-5.4-mini.
REVIEWER = _node("REVIEWER", "gpt-5.4", 0.0, None, 6000, "gpt-5.4-mini", timeout=150, retries=0)
# Re-checks every red and yellow verdict. Same model as VERIFIER, but reasoning
# tokens count against the limit: on a long contract gpt-5.5 spent all 2000 on
# reasoning and returned nothing.
REVIEW_VERIFIER = _node(
    "REVIEW_VERIFIER",
    VERIFIER.model,
    VERIFIER.temperature,
    VERIFIER.reasoning_effort,
    8000,
    ",".join(VERIFIER.fallbacks),
    timeout=120,
    retries=0,
)

MAX_RESEARCH_STEPS = 4  # tool calls per research pass (doc: planner 2-4 steps)
# A contract review needs a norm per disputed clause, so it gets more steps.
MAX_RESEARCH_STEPS_DOCUMENT = 8

# Reranking is an experiment setting, not a model decision: left to the
# planner, gpt-5.4-mini switched it on for a simple question and a 35 s CPU
# cold start dominated the whole request. Off until the A/B says otherwise.
RERANK = os.environ.get("AGENT_RERANK", "false").lower() == "true"
MAX_RETRIES = 1  # query-rewrite retries after a failed verification (doc section 8)
