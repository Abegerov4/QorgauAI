// Citations arrive as plain strings built by the backend:
//   "Трудовой кодекс Республики Казахстан, Статья 89, Пункт 1, подпункт 2)"
//   "Конституция Республики Казахстан, Статья 1"
//   "Договор пользователя, пункт 6"
//   "Калькулятор отпуска по нормам: ..."

import type { Dict } from "./dict";

export type CodeKey = "labor_code" | "constitution";

export type Citation =
  | { kind: "law"; raw: string; codeKey: CodeKey; codeShort: string; article: string; point: string }
  | { kind: "doc"; raw: string; clause: string }
  | { kind: "tool"; raw: string };

export const CODE_SHORT: Record<CodeKey, string> = {
  labor_code: "Трудовой кодекс",
  constitution: "Конституция",
};

export function parseCitation(raw: string): Citation {
  if (raw.startsWith("Договор пользователя")) {
    const m = raw.match(/пункт\s+(.+)$/i);
    return { kind: "doc", raw, clause: m ? m[1].trim() : "" };
  }
  const article = raw.match(/Статья\s+([\w.\-]+)/);
  if (!article || raw.startsWith("Калькулятор")) return { kind: "tool", raw };
  const codeKey: CodeKey = raw.startsWith("Конституция") ? "constitution" : "labor_code";
  const point = raw.slice(article.index! + article[0].length).replace(/^,\s*/, "");
  return { kind: "law", raw, codeKey, codeShort: CODE_SHORT[codeKey], article: article[1], point };
}

/** Short reference for a chip: "ТК ст. 36, п. 2" / "ЕК 36-бап, 2-тармақ" / "LC art. 36, p. 2". */
export function citationLabel(c: Citation, t: Dict): string {
  if (c.kind === "doc") return t.cite.contract(c.clause);
  if (c.kind === "tool") return t.calculatorShort;
  const parts = c.point
    .split(/,\s*/)
    .filter(Boolean)
    .map((p) => {
      const sub = p.match(/^подпункт\s+(.+)$/i);
      if (sub) return t.cite.subpoint(sub[1]);
      const point = p.match(/^Пункт\s+(.+)$/i);
      return point ? t.cite.point(point[1]) : p;
    });
  const code = c.codeKey === "constitution" ? t.cite.constitution : t.cite.labor;
  return t.cite.ref(code, c.article, parts.join(", "));
}
