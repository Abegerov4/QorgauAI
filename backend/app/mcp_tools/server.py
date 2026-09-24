"""
QorgauAI legal MCP server (course requirement 3.1: own MCP server with 2-3
meaningful tools). Paired with the Skill in skills/qorgau-legal-research/.

Each tool is a thin MCP-facing wrapper that restores the caller's trace
context from the request `_meta` (see tracing.py) and delegates to a traced
implementation, so tool spans nest inside the agent's Langfuse trace.

Run standalone (stdio transport) to test with any MCP client:
    python -m app.mcp_tools.server
"""

from __future__ import annotations

import json
from typing import Literal

from langfuse import observe
from mcp.server.mcpserver import Context, MCPServer

from app.mcp_tools.tracing import incoming_trace_context, request_meta
from app.mcp_tools.vacation_calculator import calculate_annual_leave
from app.observability import langfuse
from app.retrieval.search import get_article as _get_article
from app.retrieval.search import hybrid_search

mcp = MCPServer("qorgau-legal")

Code = Literal["constitution", "labor_code"]


def _respond(obj) -> str:
    langfuse.update_current_span(output=obj)
    return json.dumps(obj, ensure_ascii=False)


@observe(name="search_legal_corpus", as_type="tool", capture_input=False, capture_output=False)
def _search_legal_corpus(query: str, code: str | None, top_k: int, rerank: bool) -> str:
    langfuse.update_current_span(input={"query": query, "code": code, "top_k": top_k, "rerank": rerank})
    top_k = max(1, min(top_k, 10))
    candidates = hybrid_search(query, top_k=20 if rerank else top_k, code=code)
    if rerank and candidates:
        from app.retrieval.rerank import rerank as _rerank

        candidates = [candidates[r.index] for r in _rerank(query, [c.text for c in candidates], top_k=top_k)]
    return _respond(
        [
            {"citation": c.citation, "article_title": c.article, "text": c.text, "code": c.code, "article_number": c.article_number}
            for c in candidates
        ]
    )


@observe(name="get_article", as_type="tool", capture_input=False, capture_output=False)
def _get_article_tool(code: str, article_number: str) -> str:
    langfuse.update_current_span(input={"code": code, "article_number": article_number})
    chunks = _get_article(code, article_number)
    if not chunks:
        return _respond({"found": False, "message": f"Статья {article_number} не найдена в корпусе (возможно, исключена законом)."})
    return _respond(
        {
            "found": True,
            "article_title": chunks[0].article,
            "chapter": chunks[0].chapter,
            "source": chunks[0].source,
            "points": [{"citation": c.citation, "point": c.point, "text": c.text} for c in chunks],
        }
    )


@observe(name="calculate_vacation_days", as_type="tool", capture_input=False, capture_output=False)
def _calculate_vacation_days(hazardous_work: bool, disability_group_1_or_2: bool, employer_bonus_days: int) -> str:
    langfuse.update_current_span(
        input={
            "hazardous_work": hazardous_work,
            "disability_group_1_or_2": disability_group_1_or_2,
            "employer_bonus_days": employer_bonus_days,
        }
    )
    result = calculate_annual_leave(
        hazardous_work=hazardous_work,
        disability_group_1_or_2=disability_group_1_or_2,
        employer_bonus_days=employer_bonus_days,
    )
    return _respond(
        {
            "base_days": result.base_days,
            "additional_days": result.additional_days,
            "total_days": result.total_days,
            "breakdown": result.breakdown,
            "citations": result.citations,
            "note": result.note,
        }
    )


@mcp.tool()
def search_legal_corpus(query: str, ctx: Context, code: Code | None = None, top_k: int = 5, rerank: bool = False) -> str:
    """Hybrid search (dense + BM25, RRF) over the Constitution and Labor Code
    of Kazakhstan. Returns the most relevant norms with a ready-to-use
    citation for each.

    Args:
        query: question or keywords in Russian.
        code: restrict to one code -- "constitution" or "labor_code"; omit to search both.
        top_k: number of results, 1-10.
        rerank: re-score the top-20 with a cross-encoder (slower on CPU).
    """
    with incoming_trace_context(request_meta(ctx)):
        return _search_legal_corpus(query, code, top_k, rerank)


@mcp.tool()
def get_article(code: Code, article_number: str, ctx: Context) -> str:
    """Full text of one article, every point in document order. Use it after
    search_legal_corpus to quote a norm exactly and to see points that refer
    to each other ("как указано в пункте 1 настоящей статьи").

    Args:
        code: "constitution" or "labor_code".
        article_number: article number as written in the code, e.g. "88" or "20-1".
    """
    with incoming_trace_context(request_meta(ctx)):
        return _get_article_tool(code, article_number)


@mcp.tool()
def calculate_vacation_days(
    ctx: Context,
    hazardous_work: bool = False,
    disability_group_1_or_2: bool = False,
    employer_bonus_days: int = 0,
) -> str:
    """Calculate statutory minimum annual paid leave under Kazakhstan's Labor
    Code (Статья 88, Статья 89), with a per-component citation breakdown.
    Years of service alone do NOT increase the statutory minimum.

    Args:
        hazardous_work: employee works in heavy/hazardous conditions.
        disability_group_1_or_2: employee has disability group I or II.
        employer_bonus_days: extra days from the employer's own labor/
            collective agreement, if known (not a statutory guarantee).
    """
    with incoming_trace_context(request_meta(ctx)):
        return _calculate_vacation_days(hazardous_work, disability_group_1_or_2, employer_bonus_days)


if __name__ == "__main__":
    mcp.run()
