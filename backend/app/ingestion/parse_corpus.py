"""
Structure-aware parser for QorgauAI legal corpus.

Reads manually-saved pages of Kazakhstan legal codes (HTML export from a
browser, or PDF export) and turns them into structure-aware chunks:

    { text, code, chapter, article, point, chunk_type, source }

Input files are NOT downloaded by this script (see backend/data/raw/README.md
for why) -- they must already exist in backend/data/raw/, saved by hand.

Usage:
    python -m app.ingestion.parse_corpus
    python -m app.ingestion.parse_corpus --slug constitution
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from bs4 import BeautifulSoup
from jsonschema import Draft7Validator

RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"
PROCESSED_DIR = Path(__file__).resolve().parents[2] / "data" / "processed"
SCHEMA_PATH = Path(__file__).resolve().parent / "chunk_schema.json"

# slug -> human-readable code name used in the "code" field of every chunk
DOC_REGISTRY: dict[str, str] = {
    "constitution": "Конституция Республики Казахстан",
    "labor_code": "Трудовой кодекс Республики Казахстан",
}

SECTION_RE = re.compile(r"^Раздел\s+([IVXLCDM]+)\.?\s*(.*)$", re.IGNORECASE)
CHAPTER_RE = re.compile(r"^Глава\s+(\d+(?:-\d+)?)\.?\s*(.*)$", re.IGNORECASE)
ARTICLE_RE = re.compile(r"^Статья\s+(\d+(?:-\d+)?)\.?\s*(.*)$", re.IGNORECASE)
# adilet PDFs use "1. текст" for points and, nested inside a point, "48)
# текст" for sub-items (e.g. the ~50-term definition list in Статья 1 of the
# Labor Code, or short enumerations like "1) трудовые; 2) ...;" under a single
# point). These are two different levels -- treating them as one caused
# sibling sub-items to collide with unrelated top-level points sharing the
# same number.
POINT_RE = re.compile(r"^(\d+(?:-\d+)?)\.\s+(.*)$")
SUBPOINT_RE = re.compile(r"^(\d+(?:-\d+)?)\)\s+(.*)$")
HEADING_RES = (SECTION_RE, CHAPTER_RE, ARTICLE_RE)

# Lines matching any of these are dropped before parsing starts -- repeating
# watermark ("НЦПС «Әділет»", sometimes clipped mid-render to "НЦПС «Әділ")
# and page-number footers ("12 / 176") observed in real adilet.zan.kz PDF
# exports, plus generic site chrome from an HTML "save page as" dump.
JUNK_LINE_PATTERNS = [
    re.compile(r"^(Войти|Регистрация|Поиск|Личный кабинет)$", re.IGNORECASE),
    re.compile(r"^НЦПС\b", re.IGNORECASE),
    re.compile(r"^\d+\s*/\s*\d+$"),
    re.compile(r"^\s*$"),
]

# The adilet PDF export uses three distinct text styles, confirmed by
# inspecting span metadata directly: headings render bold ~12pt, body text
# regular ~11pt, and "Сноска. ..." amendment-history footnotes regular
# ~10pt -- smaller than body, not just differently worded. Classifying lines
# by their actual rendered style is far more robust than guessing from text:
# an earlier text-prefix approach ("skip footnote lines until the next
# heading") silently ate real article bodies whenever a footnote happened to
# be followed by body text rather than another heading (e.g. Статья 4 of the
# Labor Code lost its entire principles list this way).
HEADING_FONT_MIN_SIZE = 11.5
FOOTNOTE_FONT_MAX_SIZE = 10.5
HEADING_BOLD_FLAG = 1 << 4

# Fallback heuristic used only for HTML input, where no font metadata is
# available: a continuation line is short and doesn't end a sentence; real
# body text either matches POINT_RE/SUBPOINT_RE or is long/ends with '.', so
# this rarely misfires in practice.
TITLE_CONTINUATION_MAX_WORDS = 6
MAX_TITLE_CONTINUATION_LINES = 3

LineKind = str  # "heading" | "body" | "footnote", or None below when unknown


@dataclass
class Line:
    text: str
    kind: LineKind | None  # known from PDF font metadata, or None for HTML input


@dataclass
class ParseWarning:
    message: str


@dataclass
class ParserState:
    section: str = ""
    chapter: str = ""
    article_num: str = ""
    article_title: str = ""
    point_num: str = ""
    subpoint_num: str = ""
    buffer: list[str] = field(default_factory=list)


def extract_lines(path: Path) -> list[Line]:
    suffix = path.suffix.lower()
    if suffix in (".html", ".htm"):
        soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="ignore"), "lxml")
        for tag in soup(["script", "style", "nav", "header", "footer"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
        return [Line(line, None) for line in text.splitlines()]

    if suffix == ".pdf":
        import pymupdf  # imported lazily so HTML-only setups don't need it

        out: list[Line] = []
        doc = pymupdf.open(path)
        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                for pdf_line in block.get("lines", []):
                    spans = pdf_line["spans"]
                    text = "".join(s["text"] for s in spans).strip()
                    if not text:
                        continue
                    size = spans[0]["size"]
                    if size >= HEADING_FONT_MIN_SIZE and all(s["flags"] & HEADING_BOLD_FLAG for s in spans):
                        kind = "heading"
                    elif size <= FOOTNOTE_FONT_MAX_SIZE:
                        kind = "footnote"
                    else:
                        kind = "body"
                    out.append(Line(text, kind))
        return out

    raise ValueError(f"Unsupported file type: {path}")


def clean_lines(lines: list[Line]) -> list[Line]:
    out = []
    for line in lines:
        text = line.text.strip()
        if not text:
            continue
        if any(p.match(text) for p in JUNK_LINE_PATTERNS):
            continue
        out.append(Line(text, line.kind))
    return out


def drop_footnotes(lines: list[Line]) -> list[Line]:
    """Drop "Сноска. ..." amendment-history notes.

    With PDF font metadata available, each footnote line is smaller (~10pt)
    than body text (~11pt) and can be dropped individually -- no need to
    guess where the block ends. An earlier "skip until the next heading"
    approach silently ate real article bodies whenever a footnote was
    followed by body text rather than another heading (lost all of Статья 4
    of the Labor Code this way). HTML input has no font metadata, so it
    falls back to a text-prefix block-skip.
    """
    if any(l.kind is not None for l in lines):
        return [l for l in lines if l.kind != "footnote"]

    out = []
    skipping = False
    for line in lines:
        if line.text.startswith("Сноска"):
            skipping = True
            continue
        if skipping:
            if any(re_.match(line.text) for re_ in HEADING_RES):
                skipping = False
            else:
                continue
        out.append(line)
    return out


def find_content_window(lines: list[Line]) -> list[Line]:
    """Trim leading site chrome by starting at the first 'Статья 1' marker."""
    start = 0
    for i, line in enumerate(lines):
        m = ARTICLE_RE.match(line.text)
        if m and m.group(1).lstrip("0") in ("1", ""):
            start = i
            break
    return lines[start:]


def _flush(state: ParserState, code_name: str, source_note: str, out: list[dict]) -> None:
    text = " ".join(state.buffer).strip()
    state.buffer = []
    if not text or not state.article_num:
        return
    chapter_label = state.chapter
    if state.section:
        chapter_label = f"{state.section} — {state.chapter}" if state.chapter else state.section
    article_label = f"Статья {state.article_num}"
    if state.article_title:
        article_label = f"{article_label}. {state.article_title}"

    if state.point_num and state.subpoint_num:
        point_label = f"Пункт {state.point_num}, подпункт {state.subpoint_num})"
    elif state.point_num:
        point_label = f"Пункт {state.point_num}"
    elif state.subpoint_num:
        point_label = f"Подпункт {state.subpoint_num})"
    else:
        point_label = ""

    out.append(
        {
            "text": text,
            "code": code_name,
            "chapter": chapter_label,
            "article": article_label,
            "article_number": state.article_num,
            "chunk_index": len(out),
            "point": point_label,
            "chunk_type": "norm" if point_label else "article_full",
            "source": source_note,
        }
    )


def _is_structural(text: str) -> bool:
    return bool(any(re_.match(text) for re_ in HEADING_RES) or POINT_RE.match(text) or SUBPOINT_RE.match(text))


def _looks_like_title_continuation(text: str) -> bool:
    if _is_structural(text) or text.startswith("Сноска"):
        return False
    if text[-1:] in ".!?:;":
        return False
    return len(text.split()) <= TITLE_CONTINUATION_MAX_WORDS


def _consume_title(lines: list[Line], i: int, title: str) -> tuple[str, int]:
    """Greedily merge wrapped continuation lines into `title`.

    When the PDF's own font metadata is available (heading is bold/12pt,
    body is regular/11pt), continuation is resolved exactly: keep consuming
    while the next line has the same heading style as the heading itself.
    Falls back to a word-count heuristic for HTML input, where no such
    metadata exists.
    """
    cur_kind = lines[i].kind
    consumed = 0
    max_lines = 999 if cur_kind is not None else MAX_TITLE_CONTINUATION_LINES
    while consumed < max_lines and i + 1 < len(lines):
        nxt = lines[i + 1]
        if _is_structural(nxt.text) or nxt.text.startswith("Сноска"):
            break
        if cur_kind is not None:
            if nxt.kind != "heading":
                break
        elif not _looks_like_title_continuation(nxt.text):
            break
        i += 1
        consumed += 1
        title = f"{title} {nxt.text}".strip()
    return title, i


def parse_structure(lines: list[Line], code_name: str, source_note: str) -> tuple[list[dict], list[ParseWarning]]:
    state = ParserState()
    out: list[dict] = []
    warnings: list[ParseWarning] = []

    i = 0
    while i < len(lines):
        text = lines[i].text

        m_section = SECTION_RE.match(text)
        if m_section:
            _flush(state, code_name, source_note, out)
            title, i = _consume_title(lines, i, m_section.group(2).strip())
            state.section = f"Раздел {m_section.group(1)}. {title}".strip().rstrip(".")
            state.chapter = ""
            state.article_num = ""
            state.article_title = ""
            state.point_num = ""
            state.subpoint_num = ""
            i += 1
            continue

        m_chapter = CHAPTER_RE.match(text)
        if m_chapter:
            _flush(state, code_name, source_note, out)
            title, i = _consume_title(lines, i, m_chapter.group(2).strip())
            state.chapter = f"Глава {m_chapter.group(1)}. {title}".strip().rstrip(".")
            state.article_num = ""
            state.article_title = ""
            state.point_num = ""
            state.subpoint_num = ""
            i += 1
            continue

        m_article = ARTICLE_RE.match(text)
        if m_article:
            _flush(state, code_name, source_note, out)
            title, i = _consume_title(lines, i, m_article.group(2).strip())
            state.article_num = m_article.group(1)
            state.article_title = title
            state.point_num = ""
            state.subpoint_num = ""
            i += 1
            continue

        m_point = POINT_RE.match(text)
        if m_point and state.article_num:
            _flush(state, code_name, source_note, out)
            state.point_num = m_point.group(1)
            state.subpoint_num = ""
            state.buffer = [m_point.group(2)]
            i += 1
            continue

        m_subpoint = SUBPOINT_RE.match(text)
        if m_subpoint and state.article_num:
            _flush(state, code_name, source_note, out)
            state.subpoint_num = m_subpoint.group(1)
            state.buffer = [m_subpoint.group(2)]
            i += 1
            continue

        if not state.article_num:
            # Text before the first recognized article -- likely preamble or
            # leftover chrome; surfaced as a warning instead of silently kept.
            if len(text) > 40:
                warnings.append(ParseWarning(f"Unassigned text before first article: {text[:80]!r}"))
            i += 1
            continue

        state.buffer.append(text)
        i += 1

    _flush(state, code_name, source_note, out)
    return out, warnings


MIN_CHUNK_CHARS = 4


def filter_short_chunks(chunks: list[dict]) -> tuple[list[dict], list[ParseWarning]]:
    """Drop chunks that are almost certainly parsing artifacts rather than
    real legal text -- real norms are always at least a few characters."""
    kept, warnings = [], []
    for c in chunks:
        if len(c["text"]) < MIN_CHUNK_CHARS:
            warnings.append(ParseWarning(f"Dropped short chunk ({c['article']}, {c['point']!r}): {c['text']!r}"))
            continue
        kept.append(c)
    return kept, warnings


def load_source_note(slug: str) -> str:
    meta_path = RAW_DIR / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        note = meta.get(slug, {}).get("source_note")
        if note:
            return note
    print(f"[warn] no source_note in meta.json for '{slug}', using placeholder", file=sys.stderr)
    return "adilet.zan.kz, источник не указан"


def find_input_files(slug: str) -> list[Path]:
    candidates = sorted(
        p
        for p in RAW_DIR.glob(f"{slug}*")
        if p.suffix.lower() in (".html", ".htm", ".pdf")
    )
    return candidates


def validate_chunks(chunks: list[dict]) -> list[str]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft7Validator(schema)
    errors = []
    for i, chunk in enumerate(chunks):
        for err in validator.iter_errors(chunk):
            errors.append(f"chunk[{i}]: {err.message}")
    return errors


def process_slug(slug: str) -> None:
    if slug not in DOC_REGISTRY:
        raise ValueError(f"Unknown slug '{slug}', expected one of {list(DOC_REGISTRY)}")
    code_name = DOC_REGISTRY[slug]
    files = find_input_files(slug)
    if not files:
        print(f"[skip] no input files found for '{slug}' in {RAW_DIR} (see README.md)")
        return

    source_note = load_source_note(slug)
    all_lines: list[Line] = []
    for f in files:
        print(f"[read] {f.name}")
        all_lines.extend(clean_lines(extract_lines(f)))

    all_lines = drop_footnotes(all_lines)
    content_lines = find_content_window(all_lines)
    chunks, warnings = parse_structure(content_lines, code_name, source_note)
    chunks, drop_warnings = filter_short_chunks(chunks)
    warnings.extend(drop_warnings)

    for w in warnings[:20]:
        print(f"[warn] {w.message}", file=sys.stderr)
    if len(warnings) > 20:
        print(f"[warn] ... and {len(warnings) - 20} more warnings", file=sys.stderr)

    schema_errors = validate_chunks(chunks)
    if schema_errors:
        print(f"[error] {len(schema_errors)} chunk(s) failed schema validation:", file=sys.stderr)
        for e in schema_errors[:10]:
            print(f"  {e}", file=sys.stderr)
        raise SystemExit(1)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / f"{slug}_chunks.jsonl"
    with out_path.open("w", encoding="utf-8") as fh:
        for chunk in chunks:
            fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")

    articles = {c["article"] for c in chunks}
    chapters = {c["chapter"] for c in chunks}
    print(f"[ok] {slug}: {len(chunks)} chunks, {len(articles)} articles, {len(chapters)} chapters -> {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", choices=list(DOC_REGISTRY), help="process only this document")
    args = parser.parse_args()

    slugs = [args.slug] if args.slug else list(DOC_REGISTRY)
    for slug in slugs:
        process_slug(slug)


if __name__ == "__main__":
    main()
