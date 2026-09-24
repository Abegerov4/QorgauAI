"""
Langfuse client setup (doc section 10 / 12.8).

Import this module before anything that creates an OpenAI client: the
Langfuse OpenAI integration and the masking hook both hang off the client
constructed here. Tracing silently turns off when Langfuse keys are absent,
so tests and the MCP server still run without a Langfuse instance.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()  # before Langfuse reads its env vars

from langfuse import Langfuse, get_client
from langfuse.types import MaskOtelSpansParams, MaskOtelSpansResult, OtelSpanPatch

from app.guardrails.pii import contains_pii, redact


def _mask_pii_in_spans(*, params: MaskOtelSpansParams) -> MaskOtelSpansResult | None:
    """Runs at export time on every span (ours and the OpenAI integration's):
    user questions and uploaded-contract text may carry ИИН, phone numbers or
    IBANs, and those must never reach the trace store."""
    patches = {}
    for identifier, span in params.spans.items():
        changed = {
            key: redact(value)
            for key, value in span.attributes.items()
            if isinstance(value, str) and contains_pii(value)
        }
        if changed:
            patches[identifier] = OtelSpanPatch(set_attributes={**changed, "pii.masked": True})
    return MaskOtelSpansResult(span_patches=patches) if patches else None


TRACING_ENABLED = bool(os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY"))

# Keeps local experiments, eval runs and the demo apart in dashboards.
ENVIRONMENT = os.environ.get("LANGFUSE_TRACING_ENVIRONMENT", "development")

langfuse: Langfuse = Langfuse(
    mask_otel_spans=_mask_pii_in_spans,
    tracing_enabled=TRACING_ENABLED,
    environment=ENVIRONMENT,
    # MCP SDK 2.x emits its own spans around every tool call; they duplicate
    # our `tool` observations and break parenting (see mcp_tools/tracing.py).
    blocked_instrumentation_scopes=["mcp-python-sdk"],
)

__all__ = ["langfuse", "get_client", "TRACING_ENABLED"]
