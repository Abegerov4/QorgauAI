"""Shared retrieval config -- Qdrant hybrid search (dense + sparse, RRF fusion)."""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")  # None for local Docker
COLLECTION_NAME = os.environ.get("QDRANT_COLLECTION", "qorgau_legal_corpus")

# Dense: OpenAI text-embedding-3-large (see backend/data/raw/README.md-style
# note -- doc section 12 lists this as the drop-in alternative to
# multilingual-e5-large; chosen here to avoid a multi-GB local model download
# for a ~2100-chunk MVP corpus).
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
DENSE_MODEL = "text-embedding-3-large"
DENSE_DIM = 3072
DENSE_VECTOR_NAME = "dense"

# Sparse: BM25 via fastembed, runs fully locally -- no API key needed.
SPARSE_MODEL = "Qdrant/bm25"
SPARSE_VECTOR_NAME = "sparse"

PROCESSED_DIR_NAME = "processed"
