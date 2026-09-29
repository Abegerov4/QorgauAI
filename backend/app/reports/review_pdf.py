"""The contract review as a downloadable PDF.

Built from the review the client already has: HTML + CSS rendered by
PyMuPDF's Story with Noto Sans from pymupdf-fonts, so Cyrillic is real,
selectable text and no system fonts are needed on the server."""

from __future__ import annotations

import io
import re
from datetime import datetime
from html import escape

import pymupdf

LABEL = {"violation": "Нарушение", "disputed": "Спорно", "ok": "Без нарушений", "unchecked": "Не проверен"}
COLOR = {"violation": "#d93025", "disputed": "#e0a800", "ok": "#34a853", "unchecked": "#b0b0b5"}
INK = {"violation": "#b3261e", "disputed": "#8a6d1d", "ok": "#1e7b34", "unchecked": "#6e6e73"}
TINT = {"violation": "#fdecea", "disputed": "#fbf1d9", "ok": "#e6f4ea", "unchecked": "#f2f2f4"}
MONTHS = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split()

CSS = """
* { font-family: sans-serif; }
body { font-size: 10pt; line-height: 1.45; color: #1d1d1f; }
p { margin: 3pt 0; }
h1 { font-size: 16pt; font-weight: bold; margin: 2pt 0; }
h2 { font-size: 12.5pt; font-weight: bold; margin: 14pt 0 5pt 0; }
.brand { color: #8a6d1d; font-size: 8pt; font-weight: bold; }
.muted { color: #6e6e73; }
.small { font-size: 8.5pt; }
table.counts { width: 100%; margin-top: 8pt; }
table.counts td { padding: 5pt 8pt; font-size: 9pt; }
.n { font-size: 15pt; font-weight: bold; }
.item { margin: 0 0 8pt 0; padding: 6pt 9pt; border-left: 3pt solid #b0b0b5; background-color: #fafafa; }
.head { font-weight: bold; }
.quote { background-color: #f0f0f3; padding: 4pt 7pt; margin: 4pt 0; }
.norm { border-left: 2pt solid #e0a800; padding-left: 6pt; margin: 5pt 0; font-size: 9pt; }
.fix { background-color: #e6f4ea; padding: 4pt 7pt; margin-top: 5pt; }
table.ok { width: 100%; font-size: 9pt; }
table.ok td { padding: 2pt 6pt 2pt 0; border-top: 0.5pt solid #e5e5ea; }
.foot { margin-top: 14pt; border-top: 0.5pt solid #d2d2d7; padding-top: 5pt; color: #6e6e73; font-size: 8pt; }
"""


def _plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def _citation_label(raw: str) -> str:
    """'Трудовой кодекс Республики Казахстан, Статья 36, Пункт 2' -> 'ТК ст. 36, п. 2'."""
    m = re.search(r"Статья\s+([\w.\-]+)(.*)$", raw)
    if not m:
        return raw
    code = "Конст." if raw.startswith("Конституция") else "ТК"
    rest = m.group(2).strip(", ").replace("Пункт ", "п. ").replace("подпункт ", "пп. ")
    return f"{code} ст. {m.group(1)}{', ' + rest if rest else ''}"


def _item(row: dict) -> str:
    v = row["verdict"]
    parts = [
        f'<div class="item" style="border-left-color: {COLOR[v]}">',
        f'<p class="head">Пункт {escape(row["clause_number"])} '
        f'<span style="color: {INK[v]}">· {LABEL[v]}</span></p>',
        f'<p class="quote">«{escape(row["text"])}»</p>',
        f'<p><b>Почему.</b> {escape(row["explanation"])}</p>',
    ]
    if row.get("verified") is False:
        parts.append('<p class="muted small">Второй агент не подтвердил этот вывод — проверьте его с юристом.</p>')
    for norm in row.get("norms") or []:
        parts.append(f'<p class="norm"><b>{escape(_citation_label(norm["citation"]))}.</b> {escape(norm["text"])}</p>')
    if row.get("fix"):
        parts.append(f'<p class="fix"><b>Как исправить:</b> «{escape(row["fix"])}»</p>')
    parts.append("</div>")
    return "".join(parts)


def review_html(review: dict, today: datetime) -> str:
    rows = review["clauses"]
    counts = review["counts"]
    total = len(rows)
    date = f"{today.day} {MONTHS[today.month - 1]} {today.year} г."
    html = [
        '<p class="brand">QORGAUAI · ПРОВЕРКА ТРУДОВОГО ДОГОВОРА</p>',
        f"<h1>{escape(review['filename'])}</h1>",
        f'<p class="muted">{date} · {total} {_plural(total, "пункт", "пункта", "пунктов")} '
        "проверено по Трудовому кодексу и Конституции РК</p>",
        '<table class="counts"><tr>',
    ]
    for v, word in (
        ("violation", _plural(counts.get("violation", 0), "нарушение", "нарушения", "нарушений")),
        ("disputed", _plural(counts.get("disputed", 0), "спорный", "спорных", "спорных")),
        ("ok", "без нарушений"),
        ("unchecked", "не проверено"),
    ):
        if v == "unchecked" and not counts.get(v):
            continue
        html.append(
            f'<td style="background-color: {TINT[v]}; color: {INK[v]}">'
            f'<span class="n">{counts.get(v, 0)}</span><br/>{word}</td>'
        )
    html.append("</tr></table>")

    for verdict, title in (("violation", "Нарушения"), ("disputed", "Спорные пункты")):
        found = [r for r in rows if r["verdict"] == verdict]
        if found:
            html.append(f'<h2>{title} <span class="muted">{len(found)}</span></h2>')
            html.extend(_item(r) for r in found)

    ok = [r for r in rows if r["verdict"] == "ok"]
    if ok:
        html.append(f'<h2>Без нарушений <span class="muted">{len(ok)}</span></h2>')
        html.append('<p class="muted small">Противоречий найденным нормам не обнаружено.</p><table class="ok">')
        html.extend(f'<tr><td><b>{escape(r["clause_number"])}</b></td><td>{escape(r["text"])}</td></tr>' for r in ok)
        html.append("</table>")
    unchecked = [r["clause_number"] for r in rows if r["verdict"] == "unchecked"]
    if unchecked:
        html.append(f"<h2>Не проверены</h2><p>Пункты {escape(', '.join(unchecked))}: проверьте их с юристом.</p>")

    foot = []
    if review.get("truncated"):
        foot.append(f"Проверены первые {total} пунктов: договор длиннее.")
    foot += [review.get("disclaimer") or "", "Отчёт подготовлен QorgauAI · qorgau-ai.up.railway.app"]
    html.append('<div class="foot">' + "".join(f"<p>{escape(f)}</p>" for f in foot if f) + "</div>")
    return "".join(html)


def render_review_pdf(review: dict, today: datetime | None = None) -> bytes:
    archive = pymupdf.Archive()
    css = pymupdf.css_for_pymupdf_font("notos", name="sans-serif", archive=archive, CSS=CSS)
    story = pymupdf.Story(html=review_html(review, today or datetime.now()), user_css=css, archive=archive)
    out = io.BytesIO()
    writer = pymupdf.DocumentWriter(out)
    page = pymupdf.paper_rect("a4")
    area = page + (42, 42, -42, -42)
    more = True
    while more:
        device = writer.begin_page(page)
        more, _ = story.place(area)
        story.draw(device)
        writer.end_page()
    writer.close()
    # Keep only the glyphs used: ~1 MB of Noto Sans becomes ~60 KB.
    doc = pymupdf.open(stream=out.getvalue(), filetype="pdf")
    doc.subset_fonts()
    return doc.tobytes(garbage=3, deflate=True)
