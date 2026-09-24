"""Dense (OpenAI) and sparse (local BM25 via fastembed) embedding helpers."""

from __future__ import annotations

import re
from functools import lru_cache

from langfuse import observe
from qdrant_client import models

from app.observability import langfuse
from app.retrieval.config import DENSE_MODEL, OPENAI_API_KEY, SPARSE_MODEL

_WORD_RE = re.compile(r"\w+", re.UNICODE)


@lru_cache(maxsize=1)
def _openai_client():
    if not OPENAI_API_KEY:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Dense embeddings (text-embedding-3-large) "
            "need it -- set it in backend/.env or export it in your shell."
        )
    from langfuse.openai import OpenAI

    return OpenAI(api_key=OPENAI_API_KEY)


def embed_dense(texts: list[str]) -> list[list[float]]:
    """Batch-embed texts with OpenAI's text-embedding-3-large."""
    if not texts:
        return []
    resp = _openai_client().embeddings.create(model=DENSE_MODEL, input=texts, name="embed-dense")
    return [d.embedding for d in resp.data]


@lru_cache(maxsize=1)
def _sparse_model():
    from fastembed import SparseTextEmbedding

    return SparseTextEmbedding(model_name=SPARSE_MODEL)


@lru_cache(maxsize=1)
def _stemmer():
    import snowballstemmer

    return snowballstemmer.stemmer("russian")


def _stem_for_bm25(text: str) -> str:
    """Reduce Russian words to their stem before BM25 hashing.

    fastembed's BM25 tokenizer hashes word forms verbatim with no
    lemmatization, so "отпуск"/"отпуска"/"отпуску"/"отпусков" (same word,
    different grammatical case) land on four unrelated sparse indices --
    verified directly against this corpus, where it silently dropped the
    single most relevant chunk (Статья 88, the base annual-leave article)
    out of the sparse branch's top-20 for a plain-language question about
    "отпуска" despite exact phrase overlap, which in turn pushed it out of
    the RRF-fused result entirely (present in only one of two prefetch
    lists loses out to chunks present in both, even at a worse individual
    rank). Article numbers and abbreviations ("88", "ТК") pass through the
    stemmer unchanged, so this doesn't hurt exact-term matching.
    """
    words = _WORD_RE.findall(text.lower())
    if not words:
        return text
    return " ".join(_stemmer().stemWords(words))


@observe(name="embed-sparse", as_type="embedding", capture_input=False, capture_output=False)
def embed_sparse(texts: list[str]) -> list[models.SparseVector]:
    """Batch-embed texts with a local BM25 model (no API key required)."""
    if not texts:
        return []
    stemmed = [_stem_for_bm25(t) for t in texts]
    # update_current_span, not update_current_generation: the latter silently
    # retypes the observation from EMBEDDING to GENERATION.
    langfuse.update_current_span(
        input=texts,
        metadata={"model": SPARSE_MODEL, "stemmer": "snowball-russian", "stemmed_first": stemmed[0][:300], "count": len(texts)},
    )
    vectors = list(_sparse_model().embed(stemmed))
    return [models.SparseVector(indices=v.indices.tolist(), values=v.values.tolist()) for v in vectors]
