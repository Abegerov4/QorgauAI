"""Who is calling. The web app signs a short-lived HS256 token for the signed-in
Google user; the API trusts only that signature, never a user id sent in a body."""

from __future__ import annotations

from dataclasses import dataclass, replace

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, update

from app.accounts import config, db


@dataclass(frozen=True)
class User:
    email: str
    name: str | None
    role: str  # "user" | "admin"
    daily_limit: int | None = None  # set by an admin; None: the default

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def question_limit(self) -> int | None:
        """Questions a day; None for admins, who are only capped by the budget."""
        if self.is_admin:
            return None
        return self.daily_limit if self.daily_limit is not None else config.DAILY_QUESTIONS_PER_USER


def role_of(email: str) -> str:
    email = email.lower()
    local_admin = not config.AUTH_REQUIRED and email == config.LOCAL_USER_EMAIL
    return "admin" if local_admin or email in config.ADMIN_EMAILS else "user"


def decode(token: str) -> dict:
    if not config.JWT_SECRET:
        raise HTTPException(status_code=503, detail="Вход не настроен на сервере (нет BACKEND_JWT_SECRET).")
    try:
        return jwt.decode(
            token,
            config.JWT_SECRET,
            algorithms=["HS256"],
            audience=config.JWT_AUDIENCE,
            issuer=config.JWT_ISSUER,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Сессия истекла. Войдите снова.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Неверный токен. Войдите снова.")


def _remember(user: User) -> tuple[bool, int | None]:
    """Records the visit; returns what the admin set: (blocked, daily_limit)."""
    with db.engine().begin() as conn:
        seen = conn.execute(select(db.users.c.blocked, db.users.c.daily_limit).where(db.users.c.email == user.email)).first()
        if seen:
            conn.execute(update(db.users).where(db.users.c.email == user.email).values(name=user.name, last_seen_at=db.now()))
            return bool(seen.blocked), seen.daily_limit
        conn.execute(db.users.insert().values(email=user.email, name=user.name, created_at=db.now(), last_seen_at=db.now()))
        return False, None


def current_user(request: Request) -> User:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        claims = decode(header[7:].strip())
        email = str(claims["sub"]).lower()
        user = User(email=email, name=claims.get("name"), role=role_of(email))
    elif config.AUTH_REQUIRED:
        raise HTTPException(status_code=401, detail="Войдите, чтобы задавать вопросы.")
    else:
        user = User(email=config.LOCAL_USER_EMAIL, name="Local", role=role_of(config.LOCAL_USER_EMAIL))
    blocked, daily_limit = _remember(user)
    if blocked and not user.is_admin:
        raise HTTPException(status_code=403, detail="Доступ к сервису ограничен администратором.")
    return replace(user, daily_limit=daily_limit)


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Только для администратора.")
    return user
