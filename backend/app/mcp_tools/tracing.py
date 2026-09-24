"""
Trace-context propagation across the MCP boundary (Langfuse "MCP Tracing").

The agent calls tools over the real MCP protocol, so the server runs in its
own process with its own Langfuse client. The client injects the current W3C
trace context into the request's `_meta`; the server restores it before its
@observe spans start, so tool spans nest under the agent's `research` span.

Why a namespaced key instead of plain `traceparent`: MCP SDK 2.x wraps every
call in its own client/server OTel spans and writes *its* client span into
`_meta.traceparent`. That span is never exported to Langfuse, so parenting
on it leaves tool spans hanging off a missing node. We block the SDK's spans
(`observability.py`) and carry our own context under `ai.qorgau/...` keys --
a prefix format the MCP spec reserves for exactly this -- which the SDK
leaves alone. `_meta` is protocol metadata, so none of this appears in the
tool schema the LLM sees.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from opentelemetry import context as otel_context
from opentelemetry.propagate import extract, inject

_PREFIX = "ai.qorgau/"
_FIELDS = ("traceparent", "tracestate", "baggage")


def outgoing_trace_meta() -> dict[str, str]:
    carrier: dict[str, str] = {}
    inject(carrier)
    return {_PREFIX + k: v for k, v in carrier.items() if k in _FIELDS}


@contextmanager
def incoming_trace_context(meta: Any) -> Iterator[None]:
    carrier = {k[len(_PREFIX):]: v for k, v in (meta or {}).items() if k.startswith(_PREFIX)}
    if not carrier:
        yield
        return
    token = otel_context.attach(extract(carrier))
    try:
        yield
    finally:
        otel_context.detach(token)


def request_meta(ctx: Any) -> Any:
    """`_meta` of the current MCP request, or None outside a request (in-process calls in tests)."""
    try:
        return ctx.request_context.meta
    except Exception:
        return None
