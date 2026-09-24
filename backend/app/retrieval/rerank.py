"""
Cross-encoder reranker (doc section 7/12): narrows the top-20/40 hybrid
candidates down to the top-5 passed to the generator.

Uses BAAI/bge-reranker-v2-m3 -- the no-external-API alternative doc section
12 names explicitly ("Альтернатива без внешнего API: BAAI/bge-reranker-v2-m3"),
chosen here over Cohere Rerank v3 so this step needs no API key at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from langfuse import observe

from app.observability import langfuse

RERANK_MODEL = "BAAI/bge-reranker-v2-m3"


@dataclass
class RerankedCandidate:
    text: str
    score: float
    index: int  # position in the original candidate list, for traceability


@lru_cache(maxsize=1)
def _model():
    from sentence_transformers import CrossEncoder

    return CrossEncoder(RERANK_MODEL)


@observe(name="rerank-candidates", as_type="retriever", capture_input=False, capture_output=False)
def rerank(query: str, candidates: list[str], top_k: int = 5) -> list[RerankedCandidate]:
    """Score each (query, candidate) pair and return the top_k, best first."""
    langfuse.update_current_span(
        input={"query": query, "candidates": len(candidates)},
        metadata={"model": RERANK_MODEL, "top_k": top_k},
    )
    if not candidates:
        return []
    pairs = [(query, c) for c in candidates]
    scores = _model().predict(pairs)
    ranked = sorted(
        (RerankedCandidate(text=c, score=float(s), index=i) for i, (c, s) in enumerate(zip(candidates, scores))),
        key=lambda r: r.score,
        reverse=True,
    )
    langfuse.update_current_span(
        output=[{"original_index": r.index, "score": round(r.score, 4), "text": r.text} for r in ranked[:top_k]]
    )
    return ranked[:top_k]
