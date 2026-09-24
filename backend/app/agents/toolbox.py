"""
MCP client the agent uses to reach the qorgau-legal server over the real
protocol (stdio), with Langfuse trace context propagated in each request's
`_meta` so server-side tool spans nest inside the agent's trace.

One long-lived session per process: the server keeps its embedding clients
and BM25 model warm between calls instead of reloading them per request.
"""

from __future__ import annotations

import os
import sys
from contextlib import AsyncExitStack
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app.mcp_tools.tracing import outgoing_trace_meta

BACKEND_DIR = Path(__file__).resolve().parents[2]


class LegalToolbox:
    def __init__(self) -> None:
        self._stack = AsyncExitStack()
        self._session: ClientSession | None = None
        self._tools: list = []

    async def __aenter__(self) -> LegalToolbox:
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "app.mcp_tools.server"],
            cwd=str(BACKEND_DIR),
            env={**os.environ, "PYTHONPATH": str(BACKEND_DIR)},
        )
        read, write = await self._stack.enter_async_context(stdio_client(params))
        self._session = await self._stack.enter_async_context(ClientSession(read, write))
        await self._session.initialize()
        self._tools = (await self._session.list_tools()).tools
        return self

    async def __aexit__(self, *exc) -> None:
        await self._stack.aclose()

    @property
    def tool_names(self) -> list[str]:
        return [t.name for t in self._tools]

    def openai_tools(self) -> list[dict]:
        """MCP tool schemas as OpenAI function tools -- the model sees exactly
        what the server advertises, no hand-copied definitions."""
        return [
            {"type": "function", "function": {"name": t.name, "description": t.description or "", "parameters": t.input_schema}}
            for t in self._tools
        ]

    async def call(self, name: str, arguments: dict) -> tuple[str, bool]:
        """Returns (text, is_error). Tool errors are returned, not raised, so
        the model can see what went wrong and adjust its next call."""
        assert self._session is not None, "use `async with LegalToolbox()`"
        result = await self._session.call_tool(name, arguments, meta=outgoing_trace_meta())
        text = "".join(getattr(c, "text", "") for c in result.content)
        return text, bool(getattr(result, "is_error", False))
