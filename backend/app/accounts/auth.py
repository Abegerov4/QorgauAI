"""Who is calling. The web app signs a short-lived HS256 token for the signed-in
Google user; the API trusts only that signature, never a user id sent in a body."""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, update

from app.accounts import config, db


@dataclass(frozen=True)
class User:
    email: str
    name: str | None
    role: str  # "user" | "admin"

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def role_of(email: str) -> str:
    return "admin" if email.lower() in config.ADMIN_EMAILS else "user"


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


def _remember(user: User) -> None:
    with db.engine().begin() as conn:
        seen = conn.execute(select(db.users.c.email).where(db.users.c.email == user.email)).first()
        if seen:
            conn.execute(update(db.users).where(db.users.c.email == user.email).values(name=user.name, last_seen_at=db.now()))
        else:
            conn.execute(db.users.insert().values(email=user.email, name=user.name, created_at=db.now(), last_seen_at=db.now()))


def current_user(request: Request) -> User:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        claims = decode(header[7:].strip())
        email = str(claims["sub"]).lower()
        user = User(email=email, name=claims.get("name"), role=role_of(email))
    elif config.AUTH_REQUIRED:
        raise HTTPException(status_code=401, detail="Войдите, чтобы задавать вопросы.")
    else:
        user = User(email=config.LOCAL_USER_EMAIL, name="Local", role="admin")
    _remember(user)
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Только для администратора.")
    return user
