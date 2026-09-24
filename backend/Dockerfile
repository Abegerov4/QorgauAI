FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# CPU-only torch (the optional reranker): the default CUDA wheels add ~2 GB.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

COPY app ./app
COPY data/processed ./data/processed

EXPOSE 8000
# A fresh Qdrant volume gets indexed on first start; embeddings come from the
# mounted data/cache when present, so a local re-index costs nothing.
CMD ["sh", "-c", "python -m app.retrieval.index_corpus --if-empty && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
