// Citations arrive as plain strings built by the backend:
//   "Трудовой кодекс Республики Казахстан, Статья 89, Пункт 1, подпункт 2)"
//   "Конституция Республики Казахстан, Статья 1"
//   "Договор пользователя, пункт 6"
//   "Калькулятор отпуска по нормам: ..."

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

export function citationLabel(c: Citation): string {
  if (c.kind === "doc") return `Договор, п. ${c.clause}`;
  if (c.kind === "tool") return "Калькулятор";
  const point = c.point.replace(/Пункт\s+/i, "п. ").replace(/подпункт\s+/i, "пп. ");
  return `${c.codeShort === "Конституция" ? "Конст." : "ТК"} ст. ${c.article}${point ? `, ${point}` : ""}`;
}
