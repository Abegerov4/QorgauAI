"""
Embed processed corpus chunks (backend/data/processed/*_chunks.jsonl) and
upsert them into Qdrant with both dense (OpenAI) and sparse (local BM25)
vectors, so hybrid_search() (see search.py) can RRF-fuse the two.

Usage:
    python -m app.retrieval.index_corpus
    python -m app.retrieval.index_corpus --recreate
"""

from __future__ import annotations

import argparse
import json
import uuid
from pathlib import Path

from langfuse import propagate_attributes
from qdrant_client import models
from tqdm import tqdm

from app.observability import langfuse

from app.retrieval.config import COLLECTION_NAME, DENSE_VECTOR_NAME, PROCESSED_DIR_NAME, SPARSE_VECTOR_NAME
from app.retrieval.embeddings import embed_dense, embed_sparse
from app.retrieval.qdrant_setup import ensure_collection, get_client

PROCESSED_DIR = Path(__file__).resolve().parents[2] / "data" / PROCESSED_DIR_NAME
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


def index_chunks(chunks: list[dict]) -> None:
    client = get_client()
    for i in tqdm(range(0, len(chunks), BATCH_SIZE), desc="indexing"):
        batch = chunks[i : i + BATCH_SIZE]
        texts = [c["text"] for c in batch]
        dense_vecs = embed_dense(texts)
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recreate", action="store_true", help="drop and recreate the collection first")
    args = parser.parse_args()

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
