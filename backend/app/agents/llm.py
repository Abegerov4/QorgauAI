"""OpenAI calls for agent nodes: per-node params and a model fallback chain
(doc section 12.6). Every call is a Langfuse generation via the OpenAI
integration -- model, tokens and cost land in the trace automatically."""

from __future__ import annotations

from functools import lru_cache
from typing import Any, TypeVar

import openai
from pydantic import BaseModel

from app.agents import cost
from app.agents.config import NodeModel
from app.observability import langfuse
from app.retrieval.config import OPENAI_API_KEY

T = TypeVar("T", bound=BaseModel)

# Fallback can't fix bad credentials or a missing account permission.
_NO_FALLBACK = (openai.AuthenticationError, openai.PermissionDeniedError)


@lru_cache(maxsize=1)
def _client():
    from langfuse.openai import AsyncOpenAI

    # Short timeout + one retry: a stalled call (one planner step once took
    # 129 s for 23 output tokens) should fail over to the fallback model
    # quickly instead of the SDK's default 10 min timeout and 2 retries.
    return AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=40, max_retries=1)


def _params(node: NodeModel, model: str) -> dict[str, Any]:
    params: dict[str, Any] = {"model": model, "max_completion_tokens": node.max_completion_tokens}
    if model == node.model:
        # Primary model: the tuned params. Fallback models get defaults, since
        # e.g. gpt-5.5 rejects any temperature (HTTP 400) and the fallback
        # chain mixes model families.
        if node.temperature is not None:
            params["temperature"] = node.temperature
        if node.reasoning_effort is not None:
            params["reasoning_effort"] = node.reasoning_effort
    return params


async def _with_fallback(node: NodeModel, call):
    models = (node.model, *node.fallbacks)
    last_error: Exception | None = None
    for model in models:
        cost.check_budget()
        try:
            resp = await call(_params(node, model))
        except _NO_FALLBACK:
            raise
        except openai.APIError as e:
            last_error = e
            langfuse.update_current_span(
                level="WARNING",
                status_message=f"model {model} failed ({type(e).__name__}), falling back",
                metadata={"fallback_from": model},
            )
            continue
        cost.record(resp.model, resp.usage)
        return resp
    raise last_error  # type: ignore[misc]


async def chat(node: NodeModel, messages: list[dict], *, name: str, **kwargs):
    return await _with_fallback(
        node, lambda p: _client().chat.completions.create(messages=messages, name=name, **p, **kwargs)
    )


async def chat_without_input_capture(node: NodeModel, messages: list[dict], *, name: str, input_summary: dict):
    """Same as `chat`, but the request payload never reaches Langfuse.

    The Langfuse OpenAI integration uploads images from the prompt to its
    media store -- before any masking -- so a photo of a contract with an
    ИИН on it would end up in the trace store. The integration patches the
    `chat.completions` resource globally (every client, not just ours), so
    this goes through the SDK's low-level `post()` instead, which the patch
    doesn't touch. The generation is recorded by hand: model, tokens and
    the (export-masked) output are traced, the image becomes a summary.
    """
    from openai.types.chat import ChatCompletion

    with langfuse.start_as_current_observation(as_type="generation", name=name, input=input_summary) as gen:
        resp = await _with_fallback(
            node,
            lambda p: _client().post("/chat/completions", body={"messages": messages, **p}, cast_to=ChatCompletion),
        )
        gen.update(
            model=resp.model,
            output=resp.choices[0].message.content,
            usage_details={"input": resp.usage.prompt_tokens, "output": resp.usage.completion_tokens},
        )
    return resp


async def parse(node: NodeModel, messages: list[dict], response_format: type[T], *, name: str) -> T:
    resp = await _with_fallback(
        node,
        lambda p: _client().chat.completions.parse(messages=messages, response_format=response_format, name=name, **p),
    )
    parsed = resp.choices[0].message.parsed
    if parsed is None:
        raise ValueError(f"{name}: model returned no parsable output (refusal: {resp.choices[0].message.refusal!r})")
    return parsed
