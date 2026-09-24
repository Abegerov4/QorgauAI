"""
Regex PII masking for Kazakhstan/Russian formats (doc section 12.7).

Used in two places: before text from uploaded contracts reaches an LLM, and
at Langfuse export time so traces never store raw personal data. Regex is a
deliberate MVP trade-off: it has false positives (any 12-digit number looks
like an ИИН) and misses names; a model-based PII filter is Future Work.
"""

from __future__ import annotations

import re

# Order matters: more specific patterns first, so an IBAN or API key isn't
# half-eaten by the generic digit patterns below it.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("SECRET", re.compile(r"\b(?:sk|pk)-(?:lf-|proj-)?[A-Za-z0-9_\-]{16,}")),
    ("IBAN", re.compile(r"\bKZ\d{2}[A-Z0-9]{16}\b", re.IGNORECASE)),
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")),
    ("CARD", re.compile(r"\b(?:\d[ -]?){15}\d\b")),
    ("PHONE", re.compile(r"(?<!\d)(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)")),
    ("IIN", re.compile(r"(?<!\d)\d{12}(?!\d)")),
]


def mask_pii(text: str) -> tuple[str, dict[str, str]]:
    """Replace PII with placeholders like [IIN_1]. Returns the masked text and
    a placeholder -> original mapping (keep it server-side only)."""
    mapping: dict[str, str] = {}
    counters: dict[str, int] = {}

    for label, pattern in _PATTERNS:
        def _sub(m: re.Match[str], label: str = label) -> str:
            counters[label] = counters.get(label, 0) + 1
            token = f"[{label}_{counters[label]}]"
            mapping[token] = m.group(0)
            return token

        text = pattern.sub(_sub, text)
    return text, mapping


def redact(text: str) -> str:
    """Masked text only -- for logs and traces, where the mapping is never needed."""
    return mask_pii(text)[0]


def contains_pii(text: str) -> bool:
    return any(p.search(text) for _, p in _PATTERNS)
