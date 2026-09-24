import asyncio
import json

import pytest

from app.mcp_tools.server import mcp
from app.retrieval.config import OPENAI_API_KEY


def call(name: str, args: dict):
    result = asyncio.run(mcp.call_tool(name, args))
    return json.loads(result.content[0].text)


def test_server_exposes_three_tools():
    names = {t.name for t in asyncio.run(mcp.list_tools())}
    assert names == {"search_legal_corpus", "get_article", "calculate_vacation_days"}


def test_get_article_returns_points_in_order():
    body = call("get_article", {"code": "constitution", "article_number": "88"})
    assert body["found"] is True
    points = [p["point"] for p in body["points"]]
    assert points[:3] == ["Пункт 1", "Пункт 2", "Пункт 3"]


def test_get_article_distinguishes_codes():
    labor = call("get_article", {"code": "labor_code", "article_number": "88"})
    assert "двадцать четыре календарных дня" in labor["points"][0]["text"]


def test_get_article_repealed_article_not_found():
    body = call("get_article", {"code": "labor_code", "article_number": "117"})
    assert body["found"] is False


@pytest.mark.skipif(not OPENAI_API_KEY, reason="needs OPENAI_API_KEY for dense embeddings")
def test_search_respects_code_filter():
    results = call("search_legal_corpus", {"query": "государственный язык", "code": "constitution", "top_k": 3})
    assert results
    assert all(r["code"] == "Конституция Республики Казахстан" for r in results)
    assert results[0]["citation"].startswith("Конституция Республики Казахстан, Статья 9")
