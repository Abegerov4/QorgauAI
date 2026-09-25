from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BACKEND = Path(__file__).resolve().parents[2]


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL") or f"sqlite:///{BACKEND / 'data' / 'qorgau.db'}"
    # Railway hands out postgres:// / postgresql://; SQLAlchemy needs the driver named.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


DATABASE_URL = _database_url()

# Shared with the web app, which signs the tokens (Auth.js session -> API token).
JWT_SECRET = os.environ.get("BACKEND_JWT_SECRET", "")
JWT_ISSUER = "qorgau-web"
JWT_AUDIENCE = "qorgau-api"

# Off locally so `uvicorn` + `npm run dev` work without Google; on in deploy.
AUTH_REQUIRED = os.environ.get("AUTH_REQUIRED", "0") == "1"
LOCAL_USER_EMAIL = "local@qorgau.dev"

ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}

# One question costs ~$0.03 (doc section 9): 20 a day is ~$0.60 per person,
# and the global cap stops a spike from draining the account.
DAILY_QUESTIONS_PER_USER = int(os.environ.get("DAILY_QUESTIONS_PER_USER", "20"))
DAILY_BUDGET_USD = float(os.environ.get("DAILY_BUDGET_USD", "5"))

MAX_HISTORY_BYTES = 2_000_000
