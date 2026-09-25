"""Quotas, question log, feedback, chat history and the admin summary."""

from __future__ import annotations

import json
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import delete, func, insert, select, update

from app.accounts import config, db
from app.accounts.auth import User
from app.guardrails.pii import mask_pii


def usage_today(email: str) -> tuple[int, float]:
    with db.engine().connect() as conn:
        row = conn.execute(
            select(func.count(), func.coalesce(func.sum(db.questions.c.cost_usd), 0.0)).where(
                db.questions.c.user_email == email, db.questions.c.created_at >= db.start_of_day()
            )
        ).one()
    return int(row[0]), float(row[1])


def spent_today() -> float:
    with db.engine().connect() as conn:
        return float(
            conn.execute(
                select(func.coalesce(func.sum(db.questions.c.cost_usd), 0.0)).where(db.questions.c.created_at >= db.start_of_day())
            ).scalar_one()
        )


def check_quota(user: User) -> None:
    """Raises 429 before any money is spent. Admins are not capped per person,
    only by the global budget."""
    if spent_today() >= config.DAILY_BUDGET_USD:
        raise HTTPException(status_code=429, detail="Дневной бюджет сервиса исчерпан. Попробуйте завтра.")
    count, _ = usage_today(user.email)
    if not user.is_admin and count >= config.DAILY_QUESTIONS_PER_USER:
        raise HTTPException(
            status_code=429,
            detail=f"Лимит {config.DAILY_QUESTIONS_PER_USER} вопросов в день исчерпан. Попробуйте завтра.",
        )


def log_question(user: User, question: str, status: str, trace_id: str | None, cost_usd: float) -> None:
    masked, _ = mask_pii(question)  # the log is for statistics; it must not keep an IIN
    with db.engine().begin() as conn:
        conn.execute(
            insert(db.questions).values(
                user_email=user.email,
                question=masked[:2000],
                status=status,
                trace_id=trace_id,
                cost_usd=round(cost_usd, 6),
                created_at=db.now(),
            )
        )


def save_feedback(user: User, trace_id: str, value: int, comment: str | None) -> None:
    with db.engine().begin() as conn:
        asked = conn.execute(
            select(db.questions.c.id).where(db.questions.c.trace_id == trace_id, db.questions.c.user_email == user.email)
        ).first()
        if not asked:
            raise HTTPException(status_code=404, detail="Ответ не найден среди ваших вопросов.")
        conn.execute(delete(db.feedback).where(db.feedback.c.user_email == user.email, db.feedback.c.trace_id == trace_id))
        conn.execute(
            insert(db.feedback).values(
                user_email=user.email, trace_id=trace_id, value=value, comment=comment, created_at=db.now()
            )
        )


def list_chats(user: User, limit: int = 100) -> list[dict]:
    c = db.conversations.c
    with db.engine().connect() as conn:
        rows = conn.execute(
            select(c.id, c.title, c.updated_at).where(c.user_email == user.email).order_by(c.updated_at.desc()).limit(limit)
        ).all()
    return [{"id": r.id, "title": r.title, "updated_at": r.updated_at} for r in rows]


def load_chat(user: User, chat_id: str) -> dict:
    c = db.conversations.c
    with db.engine().connect() as conn:
        row = conn.execute(select(c.title, c["items"]).where(c.id == chat_id, c.user_email == user.email)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Чат не найден.")
    return {"id": chat_id, "title": row.title, "chat": dict(row[1])}


def save_chat(user: User, chat_id: str, title: str, chat: dict) -> None:
    if len(json.dumps(chat, ensure_ascii=False).encode()) > config.MAX_HISTORY_BYTES:
        raise HTTPException(status_code=413, detail="История слишком большая. Начните новый чат.")
    t, c = db.conversations, db.conversations.c
    with db.engine().begin() as conn:
        owner = conn.execute(select(c.user_email).where(c.id == chat_id)).scalar()
        if owner is None:
            conn.execute(
                insert(t).values(
                    id=chat_id, user_email=user.email, title=title, items=chat, created_at=db.now(), updated_at=db.now()
                )
            )
        elif owner == user.email:
            conn.execute(update(t).where(c.id == chat_id).values(title=title, items=chat, updated_at=db.now()))
        else:  # someone else's id: same answer as a missing chat
            raise HTTPException(status_code=404, detail="Чат не найден.")


def delete_chat(user: User, chat_id: str) -> None:
    c = db.conversations.c
    with db.engine().begin() as conn:
        conn.execute(delete(db.conversations).where(c.id == chat_id, c.user_email == user.email))


def admin_summary(trace_url) -> dict:
    """`trace_url(trace_id) -> str | None` builds a Langfuse link."""
    since_week = db.now() - timedelta(days=7)
    with db.engine().connect() as conn:
        per_user = conn.execute(
            select(
                db.questions.c.user_email,
                func.count(),
                func.coalesce(func.sum(db.questions.c.cost_usd), 0.0),
            )
            .where(db.questions.c.created_at >= db.start_of_day())
            .group_by(db.questions.c.user_email)
            .order_by(func.count().desc())
        ).all()
        totals = conn.execute(
            select(func.count(), func.coalesce(func.sum(db.questions.c.cost_usd), 0.0), func.count(func.distinct(db.questions.c.user_email)))
            .where(db.questions.c.created_at >= since_week)
        ).one()
        votes = conn.execute(
            select(db.feedback.c.value, func.count()).where(db.feedback.c.created_at >= since_week).group_by(db.feedback.c.value)
        ).all()
        negative = conn.execute(
            select(db.feedback.c.trace_id, db.feedback.c.comment, db.feedback.c.created_at, db.feedback.c.user_email, db.questions.c.question)
            .join(db.questions, db.questions.c.trace_id == db.feedback.c.trace_id, isouter=True)
            .where(db.feedback.c.value == 0)
            .order_by(db.feedback.c.created_at.desc())
            .limit(20)
        ).all()
        users_total = conn.execute(select(func.count()).select_from(db.users)).scalar_one()
    by_value = {v: n for v, n in votes}
    return {
        "today": {
            "spent_usd": round(spent_today(), 4),
            "budget_usd": config.DAILY_BUDGET_USD,
            "per_user_limit": config.DAILY_QUESTIONS_PER_USER,
            "users": [{"email": e, "questions": n, "cost_usd": round(c, 4)} for e, n, c in per_user],
        },
        "week": {
            "questions": totals[0],
            "cost_usd": round(float(totals[1]), 4),
            "active_users": totals[2],
            "helpful": by_value.get(1, 0),
            "not_helpful": by_value.get(0, 0),
        },
        "users_total": users_total,
        "negative_feedback": [
            {
                "trace_id": t,
                "trace_url": trace_url(t),
                "comment": c,
                "created_at": at.isoformat() + "Z",
                "user_email": u,
                "question": q,
            }
            for t, c, at, u, q in negative
        ],
    }
