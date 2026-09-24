"""Explicit trusted/untrusted boundary for prompts (doc section 12.7, level 1).

Everything that didn't come from our own system prompt -- the user's
question, law text from tools, uploaded contracts -- is wrapped so the model
can tell data from instructions. A prompt is not a security barrier on its
own; the graph's code (route_fn, schema validation, citation checks) is.
"""

from __future__ import annotations

import html

_CLOSE = "</untrusted_data>"


def wrap_untrusted(source: str, content: str, max_chars: int = 12000) -> str:
    content = content[:max_chars].replace(_CLOSE, "")  # can't close the tag from inside
    return f'<untrusted_data source="{html.escape(source)}">\n{content}\n{_CLOSE}'
