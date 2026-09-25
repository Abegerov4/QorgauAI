"""SQL storage. SQLAlchemy Core keeps one code path for Postgres (deploy) and
SQLite (local, tests); the schema is small enough to create on startup."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    func,
)
from sqlalchemy.engine import Engine

from app.accounts import config

metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("email", String(320), primary_key=True),
    Column("name", String(200)),
    Column("created_at", DateTime(), nullable=False),
    Column("last_seen_at", DateTime(), nullable=False),
)

# One row per question: the daily quota counts rows, the budget sums cost,
# and the admin page lists them next to the feedback.
questions = Table(
    "questions",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_email", String(320), nullable=False, index=True),
    Column("question", Text, nullable=False),  # PII-masked
    Column("status", String(20)),  # answered / partial / refused / error
    Column("trace_id", String(64), index=True),
    Column("cost_usd", Float, nullable=False, default=0.0),
    Column("created_at", DateTime(), nullable=False, index=True),
)

feedback = Table(
    "feedback",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_email", String(320), nullable=False),
    Column("trace_id", String(64), nullable=False),
    Column("value", Integer, nullable=False),  # 1 helpful, 0 not
    Column("comment", Text),
    Column("created_at", DateTime(), nullable=False),
    UniqueConstraint("user_email", "trace_id"),  # a second click changes the vote
)

# The current conversation per user, as the web app renders it.
chats = Table(
    "chats",
    metadata,
    Column("user_email", String(320), primary_key=True),
    Column("items", JSON, nullable=False),
    Column("updated_at", DateTime(), nullable=False),
)

_engine: Engine | None = None


def engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(config.DATABASE_URL, pool_pre_ping=True)
    return _engine


def init_db() -> None:
    if config.DATABASE_URL.startswith("sqlite:///"):
        from pathlib import Path

        Path(config.DATABASE_URL.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    metadata.create_all(engine())


def reset_engine(url: str) -> None:
    """Tests: point the module at a fresh database."""
    global _engine
    config.DATABASE_URL = url
    _engine = None
    init_db()


def now() -> datetime:
    """Naive UTC: SQLite has no time zones, so both backends store UTC as is."""
    return datetime.now(UTC).replace(tzinfo=None)


def start_of_day() -> datetime:
    """Quotas reset at midnight UTC (06:00 in Astana)."""
    n = now()
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


__all__ = ["chats", "engine", "feedback", "func", "init_db", "now", "questions", "start_of_day", "users"]
