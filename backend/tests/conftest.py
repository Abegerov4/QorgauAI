import os

# Tests must not write traces into the real Langfuse project. load_dotenv()
# never overrides variables that are already set, so empty keys win over
# backend/.env and app.observability turns tracing off.
os.environ["LANGFUSE_PUBLIC_KEY"] = ""
os.environ["LANGFUSE_SECRET_KEY"] = ""

import pytest

from app.accounts import config as accounts_config
from app.accounts import db as accounts_db


@pytest.fixture(autouse=True)
def accounts_sandbox(tmp_path, monkeypatch):
    """Every test gets an empty SQLite database and the local (no sign-in)
    mode; tests of sign-in turn it on themselves."""
    monkeypatch.setattr(accounts_config, "AUTH_REQUIRED", False)
    monkeypatch.setattr(accounts_config, "JWT_SECRET", "test-secret")
    monkeypatch.setattr(accounts_config, "ADMIN_EMAILS", {"admin@example.com"})
    monkeypatch.setattr(accounts_config, "DAILY_QUESTIONS_PER_USER", 3)
    monkeypatch.setattr(accounts_config, "DAILY_BUDGET_USD", 1.0)
    accounts_db.reset_engine(f"sqlite:///{tmp_path / 'test.db'}")
    yield
