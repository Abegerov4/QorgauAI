"""The contract review as a downloadable PDF.

Built from the review the client already has: HTML + CSS rendered by
PyMuPDF's Story with Ubuntu from pymupdf-fonts, so Cyrillic (Kazakh
letters included) is real, selectable text and no system fonts are needed
on the server. Noto Sans from the same package maps the Kazakh «і» to a
wrong character in the text layer."""

from __future__ import annotations

import io
import re
from datetime import datetime
from html import escape

import pymupdf

COLOR = {"violation": "#d93025", "disputed": "#e0a800", "ok": "#34a853", "unchecked": "#b0b0b5"}
INK = {"violation": "#b3261e", "disputed": "#8a6d1d", "ok": "#1e7b34", "unchecked": "#6e6e73"}
TINT = {"violation": "#fdecea", "disputed": "#fbf1d9", "ok": "#e6f4ea", "unchecked": "#f2f2f4"}

def _ru_plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def _en_plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


_RU_MONTHS = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split()
_KK_MONTHS = "қаңтар ақпан наурыз сәуір мамыр маусым шілде тамыз қыркүйек қазан қараша желтоқсан".split()
_EN_MONTHS = "January February March April May June July August September October November December".split()

# Everything the report says itself. The clause texts, the suggested wording
# and the law quotes stay as they are: the contract and the law are Russian.
TEXT = {
    "ru": {
        "label": {"violation": "Нарушение", "disputed": "Спорно", "ok": "Без нарушений", "unchecked": "Не проверен"},
        "brand": "QORGAUAI · ПРОВЕРКА ТРУДОВОГО ДОГОВОРА",
        "date": lambda d: f"{d.day} {_RU_MONTHS[d.month - 1]} {d.year} г.",
        "checked": lambda n: f"{n} {_ru_plural(n, 'пункт', 'пункта', 'пунктов')} проверено по Трудовому кодексу и Конституции РК",
        "count": {
            "violation": lambda n: _ru_plural(n, "нарушение", "нарушения", "нарушений"),
            "disputed": lambda n: _ru_plural(n, "спорный", "спорных", "спорных"),
            "ok": lambda n: "без нарушений",
            "unchecked": lambda n: "не проверено",
        },
        "sections": {"violation": "Нарушения", "disputed": "Спорные пункты", "ok": "Без нарушений", "unchecked": "Не проверены"},
        "clause": lambda n: f"Пункт {n}",
        "why": "Почему.",
        "unverified": "Второй агент не подтвердил этот вывод — проверьте его с юристом.",
        "fix": "Как исправить:",
        "ok_note": "Противоречий найденным нормам не обнаружено.",
        "unchecked_note": lambda items: f"Пункты {items}: проверьте их с юристом.",
        "truncated": lambda n: f"Проверены первые {n} пунктов: договор длиннее.",
        "footer": "Отчёт подготовлен QorgauAI · qorgau-ai.up.railway.app",
        "cite": lambda code, art, rest: f"{'Конст.' if code == 'constitution' else 'ТК'} ст. {art}{', ' + rest if rest else ''}",
        "point": lambda n: f"п. {n}",
        "subpoint": lambda n: f"пп. {n}",
    },
    "kk": {
        "label": {"violation": "Бұзушылық", "disputed": "Даулы", "ok": "Бұзушылықсыз", "unchecked": "Тексерілмеген"},
        "brand": "QORGAUAI · ЕҢБЕК ШАРТЫН ТЕКСЕРУ",
        "date": lambda d: f"{d.year} жылғы {d.day} {_KK_MONTHS[d.month - 1]}",
        "checked": lambda n: f"{n} тармақ ҚР Еңбек кодексі мен Конституциясы бойынша тексерілді",
        "count": {
            "violation": lambda n: "бұзушылық",
            "disputed": lambda n: "даулы",
            "ok": lambda n: "бұзушылықсыз",
            "unchecked": lambda n: "тексерілмеген",
        },
        "sections": {"violation": "Бұзушылықтар", "disputed": "Даулы тармақтар", "ok": "Бұзушылықсыз", "unchecked": "Тексерілмегендер"},
        "clause": lambda n: f"{n}-тармақ",
        "why": "Неліктен.",
        "unverified": "Екінші агент бұл қорытындыны растамады — оны заңгермен тексеріңіз.",
        "fix": "Қалай түзету керек:",
        "ok_note": "Табылған нормаларға қайшылық анықталмады.",
        "unchecked_note": lambda items: f"{items} тармақтары: оларды заңгермен тексеріңіз.",
        "truncated": lambda n: f"Алғашқы {n} тармақ тексерілді: шарт бұдан ұзын.",
        "footer": "Есепті QorgauAI дайындады · qorgau-ai.up.railway.app",
        "cite": lambda code, art, rest: f"{'Конст.' if code == 'constitution' else 'ЕК'} {art}-бап{', ' + rest if rest else ''}",
        "point": lambda n: f"{n}-тармақ",
        "subpoint": lambda n: f"{n}-тармақша",
    },
    "en": {
        "label": {"violation": "Violation", "disputed": "Disputed", "ok": "No violation", "unchecked": "Not checked"},
        "brand": "QORGAUAI · EMPLOYMENT CONTRACT REVIEW",
        "date": lambda d: f"{d.day} {_EN_MONTHS[d.month - 1]} {d.year}",
        "checked": lambda n: f"{n} {_en_plural(n, 'clause', 'clauses')} checked against the Labor Code and the Constitution of Kazakhstan",
        "count": {
            "violation": lambda n: _en_plural(n, "violation", "violations"),
            "disputed": lambda n: "disputed",
            "ok": lambda n: "without violations",
            "unchecked": lambda n: "not checked",
        },
        "sections": {"violation": "Violations", "disputed": "Disputed clauses", "ok": "No violations", "unchecked": "Not checked"},
        "clause": lambda n: f"Clause {n}",
        "why": "Why.",
        "unverified": "The second agent did not confirm this conclusion; check it with a lawyer.",
        "fix": "How to fix it:",
        "ok_note": "No conflict with the provisions found.",
        "unchecked_note": lambda items: f"Clauses {items}: check them with a lawyer.",
        "truncated": lambda n: f"Only the first {n} clauses were checked: the contract is longer.",
        "footer": "Report prepared by QorgauAI · qorgau-ai.up.railway.app",
        "cite": lambda code, art, rest: f"{'Const.' if code == 'constitution' else 'LC'} art. {art}{', ' + rest if rest else ''}",
        "point": lambda n: f"p. {n}",
        "subpoint": lambda n: f"subp. {n}",
    },
}

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


def _citation_label(raw: str, t: dict) -> str:
    """'Трудовой кодекс Республики Казахстан, Статья 36, Пункт 2' -> 'ТК ст. 36, п. 2' (or the kk/en form)."""
    m = re.search(r"Статья\s+([\w.\-]+)(.*)$", raw)
    if not m:
        return raw
    code = "constitution" if raw.startswith("Конституция") else "labor_code"
    parts = []
    for part in filter(None, (p.strip() for p in m.group(2).split(","))):
        sub = re.match(r"подпункт\s+(.+)$", part, re.I)
        point = re.match(r"Пункт\s+(.+)$", part, re.I)
        parts.append(t["subpoint"](sub.group(1)) if sub else t["point"](point.group(1)) if point else part)
    return t["cite"](code, m.group(1), ", ".join(parts))


def _item(row: dict, t: dict) -> str:
    v = row["verdict"]
    parts = [
        f'<div class="item" style="border-left-color: {COLOR[v]}">',
        f'<p class="head">{escape(t["clause"](row["clause_number"]))} '
        f'<span style="color: {INK[v]}">· {t["label"][v]}</span></p>',
        f'<p class="quote">«{escape(row["text"])}»</p>',
        f'<p><b>{t["why"]}</b> {escape(row["explanation"])}</p>',
    ]
    if row.get("verified") is False:
        parts.append(f'<p class="muted small">{t["unverified"]}</p>')
    for norm in row.get("norms") or []:
        parts.append(f'<p class="norm"><b>{escape(_citation_label(norm["citation"], t))}.</b> {escape(norm["text"])}</p>')
    if row.get("fix"):
        parts.append(f'<p class="fix"><b>{t["fix"]}</b> «{escape(row["fix"])}»</p>')
    parts.append("</div>")
    return "".join(parts)


def review_html(review: dict, today: datetime, lang: str = "ru") -> str:
    t = TEXT[lang]
    rows = review["clauses"]
    counts = review["counts"]
    total = len(rows)
    html = [
        f'<p class="brand">{t["brand"]}</p>',
        f"<h1>{escape(review['filename'])}</h1>",
        f'<p class="muted">{t["date"](today)} · {t["checked"](total)}</p>',
        '<table class="counts"><tr>',
    ]
    for v in ("violation", "disputed", "ok", "unchecked"):
        if v == "unchecked" and not counts.get(v):
            continue
        n = counts.get(v, 0)
        html.append(
            f'<td style="background-color: {TINT[v]}; color: {INK[v]}">'
            f'<span class="n">{n}</span><br/>{t["count"][v](n)}</td>'
        )
    html.append("</tr></table>")

    for verdict in ("violation", "disputed"):
        found = [r for r in rows if r["verdict"] == verdict]
        if found:
            html.append(f'<h2>{t["sections"][verdict]} <span class="muted">{len(found)}</span></h2>')
            html.extend(_item(r, t) for r in found)

    ok = [r for r in rows if r["verdict"] == "ok"]
    if ok:
        html.append(f'<h2>{t["sections"]["ok"]} <span class="muted">{len(ok)}</span></h2>')
        html.append(f'<p class="muted small">{t["ok_note"]}</p><table class="ok">')
        html.extend(f'<tr><td><b>{escape(r["clause_number"])}</b></td><td>{escape(r["text"])}</td></tr>' for r in ok)
        html.append("</table>")
    unchecked = [r["clause_number"] for r in rows if r["verdict"] == "unchecked"]
    if unchecked:
        html.append(f'<h2>{t["sections"]["unchecked"]}</h2><p>{escape(t["unchecked_note"](", ".join(unchecked)))}</p>')

    foot = []
    if review.get("truncated"):
        foot.append(t["truncated"](total))
    foot += [review.get("disclaimer") or "", t["footer"]]
    html.append('<div class="foot">' + "".join(f"<p>{escape(f)}</p>" for f in foot if f) + "</div>")
    return "".join(html)


def render_review_pdf(review: dict, today: datetime | None = None, lang: str = "ru") -> bytes:
    archive = pymupdf.Archive()
    css = pymupdf.css_for_pymupdf_font("ubuntu", name="sans-serif", archive=archive, CSS=CSS)
    story = pymupdf.Story(html=review_html(review, today or datetime.now(), lang), user_css=css, archive=archive)
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
    # Keep only the glyphs used, so the embedded font stays small.
    doc = pymupdf.open(stream=out.getvalue(), filetype="pdf")
    doc.subset_fonts()
    return doc.tobytes(garbage=3, deflate=True)
