from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.accounts.db import init_db
from app.agents.graph import build_graph
from app.agents.toolbox import LegalToolbox
from app.api.routes import router
from app.observability import langfuse


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # One MCP session for the app's lifetime: the tool server keeps its
    # models warm instead of being spawned per request.
    async with LegalToolbox() as toolbox:
        app.state.graph = build_graph(toolbox)
        yield
    langfuse.flush()  # buffered traces would otherwise be lost on shutdown


app = FastAPI(title="QorgauAI API", version="0.1.0", lifespan=lifespan)

# The deployed web app's origin only; "*" locally. Auth is a bearer token, not
# a cookie, so no credentials mode is needed.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
