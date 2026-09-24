"""Money spent on OpenAI chat calls, counted in-process from `usage`.

Langfuse computes the same numbers per trace, but only after ingestion; an
eval run needs them live to stop before it overspends. Prices are USD per
token, copied from Langfuse's model definitions (GET /api/public/models,
September 2026). Embeddings (~$0.13 per 1M tokens) are left out: a whole
eval run embeds a few thousand tokens.
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field

# model prefix -> (input, cached input, output) USD per token
PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-5.5": (5e-6, 5e-7, 3e-5),
    "gpt-5.4-mini": (7.5e-7, 7.5e-8, 4.5e-6),
    "gpt-5.4-nano": (2e-7, 2e-8, 1.25e-6),
    "gpt-5.4": (2.5e-6, 2.5e-7, 1.5e-5),
}


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class Meter:
    usd: float = 0.0
    calls: int = 0
    by_model: dict[str, float] = field(default_factory=dict)


GLOBAL = Meter()
# Per-request meter: set a fresh Meter in a task, and every LLM call made by
# that task (and the graph nodes it awaits) adds to it.
CURRENT: ContextVar[Meter | None] = ContextVar("cost_meter", default=None)
_budget_usd: float | None = None


def set_budget(usd: float | None) -> None:
    global _budget_usd
    _budget_usd = usd


def check_budget() -> None:
    if _budget_usd is not None and GLOBAL.usd >= _budget_usd:
        raise BudgetExceeded(f"budget ${_budget_usd:.2f} reached (spent ${GLOBAL.usd:.3f})")


def price_of(model: str) -> tuple[float, float, float]:
    for prefix in sorted(PRICES, key=len, reverse=True):
        if model.startswith(prefix):
            return PRICES[prefix]
    raise KeyError(f"no price for model {model!r}; add it to app.agents.cost.PRICES")


def record(model: str, usage) -> float:
    if usage is None:
        return 0.0
    inp, cached_inp, out = price_of(model)
    details = getattr(usage, "prompt_tokens_details", None)
    cached = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    usd = (usage.prompt_tokens - cached) * inp + cached * cached_inp + usage.completion_tokens * out
    for meter in (GLOBAL, CURRENT.get()):
        if meter is not None:
            meter.usd += usd
            meter.calls += 1
            meter.by_model[model] = meter.by_model.get(model, 0.0) + usd
    return usd
