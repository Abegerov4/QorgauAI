"""Structured outputs of every agent node (course requirement: JSON Schema on
all key nodes). OpenAI derives a strict JSON schema from these models, and
the same models validate the response -- one source of truth."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ResearchSummary(BaseModel):
    """Arguments of the `finish_research` tool the Planner calls to end its loop."""

    intent: str = Field(description="Что хочет пользователь, одной фразой, например 'узнать длительность отпуска'.")
    in_scope: bool = Field(description="Вопрос о Конституции или Трудовом кодексе РК, на который корпус может ответить.")
    missing_info: list[str] = Field(description="Чего не хватает для точного ответа (например, работает ли человек во вредных условиях).")
    reasoning: str = Field(description="Коротко: почему найденных норм достаточно или почему тема вне корпуса.")


class DraftClaim(BaseModel):
    text: str = Field(description="Одно утверждение, одно-два предложения.")
    evidence_ids: list[str] = Field(description="Номера фрагментов, на которые опирается утверждение, например ['E1', 'E3'].")


class Draft(BaseModel):
    claims: list[DraftClaim]
    missing_info: list[str]
    recommend_lawyer: bool = Field(description="True, если спор, суд или высокая цена ошибки.")


class ClaimCheck(BaseModel):
    claim_index: int = Field(description="Индекс утверждения из списка, начиная с 0.")
    supported: bool = Field(description="True, только если процитированные фрагменты прямо подтверждают утверждение.")
    confidence: float = Field(description="Уверенность от 0 до 1.")
    explanation: str = Field(description="Одно предложение: что именно подтверждает или чего не хватает.")


class Verification(BaseModel):
    checks: list[ClaimCheck]


class AnswerClaim(BaseModel):
    text: str
    sources: list[str]


class FinalAnswer(BaseModel):
    status: Literal["answered", "partial", "refused"]
    answer: str
    claims: list[AnswerClaim]
    sources: list[str]
    missing_info: list[str]
    removed_claims: list[str] = Field(description="Утверждения, которые Verifier не подтвердил и которые не показаны пользователю.")
    recommend_lawyer: bool
    disclaimer: str
