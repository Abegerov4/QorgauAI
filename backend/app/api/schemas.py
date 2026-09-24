"""Pydantic request/response models for the REST API (doc section 12)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.agents.schemas import FinalAnswer
from app.ingestion.documents import Clause


class HealthResponse(BaseModel):
    status: str = "ok"
    qdrant_connected: bool
    collection_exists: bool


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(5, ge=1, le=20)
    pipeline: str = Field("hybrid", pattern="^(dense|hybrid)$")


class SourceChunk(BaseModel):
    text: str
    code: str
    chapter: str
    article: str
    article_number: str
    point: str
    chunk_type: str
    source: str
    score: float


class SearchResponse(BaseModel):
    query: str
    pipeline: str
    results: list[SourceChunk]


class ArticlePoint(BaseModel):
    point: str
    text: str


class ArticleResponse(BaseModel):
    code: str
    chapter: str
    article: str
    article_number: str
    points: list[ArticlePoint]


class AskRequest(BaseModel):
    question: str = Field("Проверь мой трудовой договор на соответствие Трудовому кодексу РК.", min_length=1, max_length=4000)
    session_id: str | None = Field(None, max_length=200, description="Groups the turns of one conversation in Langfuse.")
    document_id: str | None = Field(None, description="Id from POST /documents; its clauses become evidence D<n>.")


class PageInfo(BaseModel):
    page: int
    method: str
    chars: int


class DocumentResponse(BaseModel):
    document_id: str
    filename: str
    document_type: str
    pages: list[PageInfo]
    pii_found: list[str]
    clauses: list[Clause]


class ToolCall(BaseModel):
    name: str = Field(description="MCP tool: search_legal_corpus, get_article or calculate_vacation_days.")
    args: dict
    found: list[str] = Field(description="Citations the tool returned (for get_article: the article itself).")
    result: str | None = Field(None, description="Short result of a calculation, e.g. '30 календарных дней'.")
    attempt: int = Field(description="0 for the first research pass, 1 after rewrite_query.")


class AskResponse(FinalAnswer):
    path: list[str] = Field(description="Graph nodes visited, e.g. guard_input -> research -> generate -> verify -> finalize.")
    attempts: int
    tool_calls: list[ToolCall] = Field(default_factory=list, description="What the research agent did, in order.")
    checked_claims: int = Field(0, description="Claims the verifier checked on the last pass.")
    supported_claims: int = Field(0, description="Of those, confirmed by the cited norms.")

    @classmethod
    def from_state(cls, state: dict) -> "AskResponse":
        checks = (state.get("verification") or {}).get("checks") or []
        return cls(
            **state["final"],
            path=state["path"],
            attempts=state.get("attempt", 0) + 1,
            tool_calls=state.get("tool_log") or [],
            checked_claims=len(checks),
            supported_claims=sum(c["supported"] for c in checks),
        )


class VacationCalcRequest(BaseModel):
    hazardous_work: bool = False
    disability_group_1_or_2: bool = False
    employer_bonus_days: int = Field(0, ge=0)
