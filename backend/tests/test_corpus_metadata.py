"""Source dates must reach MCP, including collections indexed before the fix."""

import asyncio
import json
from unittest.mock import Mock

import pytest
from qdrant_client import QdrantClient, models

from app.ingestion.parse_corpus import DOC_REGISTRY, RAW_DIR
from app.mcp_tools.server import mcp
from app.retrieval import index_corpus, search


def test_processed_sources_match_verified_metadata():
    meta = json.loads((RAW_DIR / "meta.json").read_text())
    expected = {DOC_REGISTRY[slug]: item["source_note"] for slug, item in meta.items()}
    chunks = index_corpus.load_chunks()
    assert {c["code"] for c in chunks} == set(expected)
    for chunk in chunks:
        assert chunk["source"] == expected[chunk["code"]]
        assert "<" not in chunk["source"]
    assert meta["constitution"]["revision_date"] == "2026-03-15"
    assert meta["labor_code"]["revision_date"] == "2026-09-06"


@pytest.fixture
def indexed_corpus(monkeypatch):
    chunks = [c for c in index_corpus.load_chunks() if c["article_number"] == "88"]
    client = QdrantClient(":memory:")
    client.create_collection(
        collection_name=index_corpus.COLLECTION_NAME,
        vectors_config=models.VectorParams(size=2, distance=models.Distance.DOT),
    )
    client.upsert(
        collection_name=index_corpus.COLLECTION_NAME,
        points=[models.PointStruct(
            id=index_corpus._stable_id(c), vector=[1.0, 2.0],
            payload={**c, "source": "adilet.zan.kz, редакция от <впишите дату с сайта>"},
        ) for c in chunks],
    )
    monkeypatch.setattr(index_corpus, "get_client", lambda: client)
    monkeypatch.setattr(search, "get_client", lambda: client)
    yield client, chunks
    client.close()


def test_source_refresh_reaches_mcp_without_changing_text_or_vectors(indexed_corpus):
    client, chunks = indexed_corpus
    assert index_corpus.refresh_sources(chunks) == len(chunks)
    assert index_corpus.refresh_sources(chunks) == 0
    stored = client.retrieve(
        collection_name=index_corpus.COLLECTION_NAME,
        ids=[index_corpus._stable_id(c) for c in chunks], with_vectors=True,
    )
    expected = {index_corpus._stable_id(c): c for c in chunks}
    assert client.count(index_corpus.COLLECTION_NAME).count == len(chunks)
    for point in stored:
        assert point.payload == expected[point.id]
        assert point.vector == [1.0, 2.0]
    for slug, code in DOC_REGISTRY.items():
        result = asyncio.run(mcp.call_tool("get_article", {"code": slug, "article_number": "88"}))
        body = json.loads(result.content[0].text)
        assert body["found"] is True
        assert body["source"] == next(c["source"] for c in chunks if c["code"] == code)
        assert body["points"]


def test_source_refresh_rejects_different_edition_before_writing(indexed_corpus, monkeypatch):
    client, chunks = indexed_corpus
    # The stable ID only includes the first 50 text characters: a different
    # ending must not silently acquire the current corpus's revision date.
    chunk = chunks[-1]
    client.set_payload(
        collection_name=index_corpus.COLLECTION_NAME,
        points=[index_corpus._stable_id(chunk)], payload={"text": chunk["text"] + " Другая редакция."},
    )
    write = Mock(wraps=client.set_payload)
    monkeypatch.setattr(client, "set_payload", write)
    with pytest.raises(ValueError, match="Corpus differs"):
        index_corpus.refresh_sources(chunks)
    write.assert_not_called()


def test_if_empty_refreshes_existing_collection_without_embeddings(indexed_corpus, monkeypatch):
    _, chunks = indexed_corpus
    monkeypatch.setattr(index_corpus, "load_chunks", lambda: chunks)
    monkeypatch.setattr("sys.argv", ["index_corpus", "--if-empty"])
    embed = Mock(side_effect=AssertionError("metadata must not trigger embedding"))
    monkeypatch.setattr(index_corpus, "index_chunks", embed)
    index_corpus.main()
    embed.assert_not_called()
    assert index_corpus.refresh_sources(chunks) == 0


def test_if_empty_start_survives_a_mismatched_index(indexed_corpus, monkeypatch, capsys):
    client, chunks = indexed_corpus
    chunk = chunks[-1]
    client.set_payload(
        collection_name=index_corpus.COLLECTION_NAME,
        points=[index_corpus._stable_id(chunk)], payload={"text": chunk["text"] + " Другая редакция."},
    )
    monkeypatch.setattr(index_corpus, "load_chunks", lambda: chunks)
    monkeypatch.setattr("sys.argv", ["index_corpus", "--if-empty"])
    index_corpus.main()  # must not raise: uvicorn starts after it
    assert "source notes not refreshed" in capsys.readouterr().err
