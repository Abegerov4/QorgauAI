"""
Embed processed corpus chunks (backend/data/processed/*_chunks.jsonl) and
upsert them into Qdrant with both dense (OpenAI) and sparse (local BM25)
vectors, so hybrid_search() (see search.py) can RRF-fuse the two.

Chunks are embedded as is. Adding an "article title + lead-in" header was
tried and measured (doc section 9): on every chunk it cost Recall@5 0.87 ->
0.80, on short chunks only 0.76 -- the headers made subpoints of related
articles look like the query and pushed the governing article out of the
top 5. Short fragments are excluded from search instead (see search.py).

Dense vectors are cached in data/cache/ keyed by model and text, so a
re-index (or CI) only pays for chunks whose text changed.

Usage:
    python -m app.retrieval.index_corpus
    python -m app.retrieval.index_corpus --recreate
    python -m app.retrieval.index_corpus --if-empty   # Docker start-up: index only a fresh Qdrant
    python -m app.retrieval.index_corpus --refresh-sources  # metadata only; no embedding calls
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import uuid
from pathlib import Path

import numpy as np

from langfuse import propagate_attributes
from qdrant_client import models
from tqdm import tqdm

from app.observability import langfuse

from app.retrieval.config import COLLECTION_NAME, DENSE_MODEL, DENSE_VECTOR_NAME, PROCESSED_DIR_NAME, SPARSE_VECTOR_NAME
from app.retrieval.embeddings import embed_dense, embed_sparse
from app.retrieval.qdrant_setup import ensure_collection, get_client

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PROCESSED_DIR = DATA_DIR / PROCESSED_DIR_NAME
CACHE_FILE = DATA_DIR / "cache" / f"dense-{DENSE_MODEL}.npz"
BATCH_SIZE = 64


def load_chunks() -> list[dict]:
    chunks = []
    for f in sorted(PROCESSED_DIR.glob("*_chunks.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip():
                chunks.append(json.loads(line))
    return chunks


def _stable_id(chunk: dict) -> str:
    # Deterministic id from content -- re-running the indexer upserts in
    # place instead of duplicating points.
    key = f"{chunk['code']}|{chunk['article']}|{chunk['point']}|{chunk['text'][:50]}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, key))


def refresh_sources(chunks: list[dict]) -> int:
    """Update source notes of existing, unchanged chunks without re-embedding.

    Validate the complete payload before changing a date: the stable ID uses
    only the start of the text and could also identify a different edition.
    """
    client = get_client()
    updates: dict[str, list[str]] = {}
    for i in range(0, len(chunks), BATCH_SIZE):
        expected = {_stable_id(c): c for c in chunks[i : i + BATCH_SIZE]}
        points = client.retrieve(
            collection_name=COLLECTION_NAME, ids=list(expected), with_payload=True, with_vectors=False,
        )
        for point in points:
            chunk = expected[str(point.id)]
            payload = point.payload or {}
            if payload.get("source") == chunk["source"]:
                continue
            if any(payload.get(k) != v for k, v in chunk.items() if k != "source"):
                raise ValueError(f"Corpus differs at {point.id}; re-index before updating source dates")
            updates.setdefault(chunk["source"], []).append(str(point.id))

    # Only write once all candidate payloads have been checked.
    for source, ids in updates.items():
        client.set_payload(collection_name=COLLECTION_NAME, payload={"source": source}, points=ids, wait=True)
    return sum(len(ids) for ids in updates.values())


class DenseCache:
    def __init__(self, path: Path):
        self.path = path
        self.vectors: dict[str, np.ndarray] = {}
        if path.exists():
            data = np.load(path)
            self.vectors = dict(zip(data["keys"].tolist(), data["vectors"]))

    @staticmethod
    def key(text: str) -> str:
        return hashlib.sha1(f"{DENSE_MODEL}|{text}".encode()).hexdigest()

    def embed(self, texts: list[str]) -> list[list[float]]:
        missing = [t for t in dict.fromkeys(texts) if self.key(t) not in self.vectors]
        for i in range(0, len(missing), BATCH_SIZE):
            batch = missing[i : i + BATCH_SIZE]
            for t, v in zip(batch, embed_dense(batch)):
                self.vectors[self.key(t)] = np.asarray(v, dtype=np.float32)
        return [self.vectors[self.key(t)].tolist() for t in texts]

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        keys = list(self.vectors)
        np.savez_compressed(self.path, keys=np.array(keys), vectors=np.stack([self.vectors[k] for k in keys]))


def index_chunks(chunks: list[dict]) -> None:
    client = get_client()
    cache = DenseCache(CACHE_FILE)
    cached_before = len(cache.vectors)
    for i in tqdm(range(0, len(chunks), BATCH_SIZE), desc="indexing"):
        batch = chunks[i : i + BATCH_SIZE]
        texts = [c["text"] for c in batch]
        dense_vecs = cache.embed(texts)
        sparse_vecs = embed_sparse(texts)

        points = [
            models.PointStruct(
                id=_stable_id(chunk),
                vector={
                    DENSE_VECTOR_NAME: dense_vecs[j],
                    SPARSE_VECTOR_NAME: sparse_vecs[j],
                },
                payload=chunk,
            )
            for j, chunk in enumerate(batch)
        ]
        client.upsert(collection_name=COLLECTION_NAME, points=points)
    cache.save()
    print(f"[info] dense embeddings: {len(cache.vectors) - cached_before} new, rest from cache")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--recreate", action="store_true", help="drop and recreate the collection first")
    mode.add_argument("--if-empty", action="store_true", help="index a fresh collection; refresh source notes in an existing one")
    mode.add_argument("--refresh-sources", action="store_true", help="refresh source notes only, without embedding or changing vectors")
    args = parser.parse_args()

    chunks = load_chunks()
    if not chunks:
        print(f"[skip] no chunks found in {PROCESSED_DIR} -- run app.ingestion.parse_corpus first")
        return

    if args.refresh_sources:
        print(f"[ok] refreshed source notes on {refresh_sources(chunks)} chunks")
        return

    if args.if_empty:
        client = get_client()
        if client.collection_exists(COLLECTION_NAME) and client.count(COLLECTION_NAME).count > 0:
            # Start-up must not fail over metadata: a mismatch leaves the old
            # dates in place and the API still starts.
            try:
                refreshed = refresh_sources(chunks)
            except Exception as e:
                print(f"[warn] {COLLECTION_NAME} already indexed; source notes not refreshed: {e}", file=sys.stderr)
            else:
                print(f"[skip] {COLLECTION_NAME} already indexed; refreshed source notes on {refreshed} chunks")
            return

    ensure_collection(recreate=args.recreate)
    print(f"[info] indexing {len(chunks)} chunks from {PROCESSED_DIR}")
    with langfuse.start_as_current_observation(
        as_type="span", name="index-corpus", input={"chunks": len(chunks), "recreate": args.recreate}
    ), propagate_attributes(trace_name="index-corpus", tags=["indexing"]):
        index_chunks(chunks)
    langfuse.flush()
    print("[ok] done")


if __name__ == "__main__":
    main()
