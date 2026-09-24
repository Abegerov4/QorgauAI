from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents.graph import build_graph
from app.agents.toolbox import LegalToolbox
from app.api.routes import router
from app.observability import langfuse


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One MCP session for the app's lifetime: the tool server keeps its
    # models warm instead of being spawned per request.
    async with LegalToolbox() as toolbox:
        app.state.graph = build_graph(toolbox)
        yield
    langfuse.flush()  # buffered traces would otherwise be lost on shutdown


app = FastAPI(title="QorgauAI API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # MVP scope, no auth (doc section 12) -- tighten before any public deploy
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
