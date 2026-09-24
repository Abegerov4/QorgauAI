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


class AskResponse(FinalAnswer):
    path: list[str] = Field(description="Graph nodes visited, e.g. guard_input -> research -> generate -> verify -> finalize.")
    attempts: int


class VacationCalcRequest(BaseModel):
    hazardous_work: bool = False
    disability_group_1_or_2: bool = False
    employer_bonus_days: int = Field(0, ge=0)
