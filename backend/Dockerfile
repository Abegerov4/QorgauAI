FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# The reranker (and torch) stays out of the image: it is off by default, see
# requirements-rerank.txt.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data/processed ./data/processed

EXPOSE 8000
# A fresh Qdrant volume gets indexed on first start; embeddings come from the
# mounted data/cache when present, so a local re-index costs nothing.
# Railway sets PORT; docker-compose uses the default.
CMD ["sh", "-c", "python -m app.retrieval.index_corpus --if-empty && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
