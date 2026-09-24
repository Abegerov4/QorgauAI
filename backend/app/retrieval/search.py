"""
Hybrid retrieval: Qdrant Query API, dense (OpenAI) + sparse (BM25) prefetch,
fused with RRF (doc section 7):

    RRF(d) = sum(1 / (k + rank_i(d)))

Qdrant's `FusionQuery(fusion=Fusion.RRF)` implements this natively over the
two prefetched result lists -- fusing by rank rather than raw score, since
dense cosine similarity and sparse BM25 scores aren't on comparable scales.
"""

from __future__ import annotations

from dataclasses import dataclass

from langfuse import observe
from qdrant_client import models

from app.observability import langfuse
from app.retrieval.config import COLLECTION_NAME, DENSE_VECTOR_NAME, SPARSE_VECTOR_NAME
from app.retrieval.embeddings import embed_dense, embed_sparse
from app.retrieval.qdrant_setup import get_client

PREFETCH_LIMIT = 20

CODE_NAMES: dict[str, str] = {
    "constitution": "Конституция Республики Казахстан",
    "labor_code": "Трудовой кодекс Республики Казахстан",
}


@dataclass
class RetrievedChunk:
    text: str
    code: str
    chapter: str
    article: str
    article_number: str
    point: str
    chunk_type: str
    source: str
    score: float

    @property
    def citation(self) -> str:
        parts = [self.code, f"Статья {self.article_number}"]
        if self.point:
            parts.append(self.point)
        return ", ".join(parts)


def _to_chunk(p) -> RetrievedChunk:
    return RetrievedChunk(
        text=p.payload["text"],
        code=p.payload["code"],
        chapter=p.payload["chapter"],
        article=p.payload["article"],
        article_number=p.payload["article_number"],
        point=p.payload["point"],
        chunk_type=p.payload["chunk_type"],
        source=p.payload["source"],
        score=getattr(p, "score", None) or 0.0,
    )


def _trace_results(results: list[RetrievedChunk]) -> list[RetrievedChunk]:
    langfuse.update_current_span(
        output=[{"citation": r.citation, "score": round(r.score, 4), "text": r.text} for r in results]
    )
    return results


def _code_filter(code: str | None) -> models.Filter | None:
    if code is None:
        return None
    if code not in CODE_NAMES:
        raise ValueError(f"Unknown code '{code}', expected one of {list(CODE_NAMES)}")
    return models.Filter(must=[models.FieldCondition(key="code", match=models.MatchValue(value=CODE_NAMES[code]))])


def _search_filter(code: str | None) -> models.Filter:
    """Search skips repealed provisions ("исключен Законом ...") and bare
    list items ("отпуска."): both match queries by topic words but carry no
    norm on their own. get_article still returns them in place."""
    flt = _code_filter(code) or models.Filter()
    flt.must_not = [models.FieldCondition(key="chunk_type", match=models.MatchAny(any=["repealed", "fragment"]))]
    return flt


@observe(name="retrieve-hybrid", as_type="retriever", capture_input=False, capture_output=False)
def hybrid_search(
    query: str,
    top_k: int = 5,
    prefetch_limit: int = PREFETCH_LIMIT,
    code: str | None = None,
) -> list[RetrievedChunk]:
    langfuse.update_current_span(
        input={"query": query},
        metadata={"top_k": top_k, "prefetch_limit": prefetch_limit, "code_filter": code, "fusion": "rrf", "collection": COLLECTION_NAME},
    )
    client = get_client()
    dense_vec = embed_dense([query])[0]
    sparse_vec = embed_sparse([query])[0]
    flt = _search_filter(code)

    result = client.query_points(
        collection_name=COLLECTION_NAME,
        prefetch=[
            models.Prefetch(query=dense_vec, using=DENSE_VECTOR_NAME, limit=prefetch_limit, filter=flt),
            models.Prefetch(query=sparse_vec, using=SPARSE_VECTOR_NAME, limit=prefetch_limit, filter=flt),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=top_k,
        with_payload=True,
    )
    return _trace_results([_to_chunk(p) for p in result.points])


@observe(name="retrieve-dense", as_type="retriever", capture_input=False, capture_output=False)
def dense_only_search(query: str, top_k: int = 5, code: str | None = None) -> list[RetrievedChunk]:
    """Pipeline A (baseline) -- plain dense vector search, no fusion, no
    rerank. Kept separate so the A/B/C benchmark (doc section 9) can call it
    directly without going through hybrid_search."""
    langfuse.update_current_span(
        input={"query": query},
        metadata={"top_k": top_k, "code_filter": code, "collection": COLLECTION_NAME},
    )
    client = get_client()
    dense_vec = embed_dense([query])[0]
    result = client.query_points(
        collection_name=COLLECTION_NAME,
        query=dense_vec,
        using=DENSE_VECTOR_NAME,
        query_filter=_search_filter(code),
        limit=top_k,
        with_payload=True,
    )
    return _trace_results([_to_chunk(p) for p in result.points])


@observe(name="retrieve-article", as_type="retriever", capture_input=False, capture_output=False)
def get_article(code: str, article_number: str) -> list[RetrievedChunk]:
    """All chunks of one article in document order -- the parent context for
    a point-level hit (doc section 6), without a separate parent index."""
    langfuse.update_current_span(input={"code": code, "article_number": article_number})
    flt = _code_filter(code)
    flt.must.append(models.FieldCondition(key="article_number", match=models.MatchValue(value=article_number)))
    points, _ = get_client().scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=flt,
        limit=500,
        with_payload=True,
    )
    return _trace_results([_to_chunk(p) for p in sorted(points, key=lambda p: p.payload["chunk_index"])])
