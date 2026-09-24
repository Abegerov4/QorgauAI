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
"""

from __future__ import annotations

import argparse
import hashlib
import json
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
    parser.add_argument("--recreate", action="store_true", help="drop and recreate the collection first")
    parser.add_argument("--if-empty", action="store_true", help="do nothing if the collection already has points")
    args = parser.parse_args()

    if args.if_empty:
        client = get_client()
        if client.collection_exists(COLLECTION_NAME) and client.count(COLLECTION_NAME).count > 0:
            print(f"[skip] {COLLECTION_NAME} already indexed")
            return

    ensure_collection(recreate=args.recreate)
    chunks = load_chunks()
    if not chunks:
        print(f"[skip] no chunks found in {PROCESSED_DIR} -- run app.ingestion.parse_corpus first")
        return
    print(f"[info] indexing {len(chunks)} chunks from {PROCESSED_DIR}")
    with langfuse.start_as_current_observation(
        as_type="span", name="index-corpus", input={"chunks": len(chunks), "recreate": args.recreate}
    ), propagate_attributes(trace_name="index-corpus", tags=["indexing"]):
        index_chunks(chunks)
    langfuse.flush()
    print("[ok] done")


if __name__ == "__main__":
    main()
