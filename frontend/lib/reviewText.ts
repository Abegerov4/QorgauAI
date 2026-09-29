// Plain-text pieces built from a finished contract review: the employer letter
// and the question for "ask about this clause". Built from the verdicts alone,
// so nothing here can cite a norm the review did not find.

import type { ContractReview, ReviewRow } from "./api";
import { parseCitation } from "./citations";

const CODE_GENITIVE = { labor_code: "Трудового кодекса РК", constitution: "Конституции РК" } as const;

const ARTICLE = { dative: "статье", genitive: "статьи" } as const;

/** "статье 36 (пункт 2) Трудового кодекса РК": after "противоречит" (dative) or "с учётом" (genitive). */
export function lawRef(raw: string, grammaticalCase: keyof typeof ARTICLE = "genitive"): string {
  const c = parseCitation(raw);
  if (c.kind !== "law") return raw;
  const point = c.point ? ` (${c.point.charAt(0).toLowerCase()}${c.point.slice(1)})` : "";
  return `${ARTICLE[grammaticalCase]} ${c.article}${point} ${CODE_GENITIVE[c.codeKey]}`;
}

function refs(row: ReviewRow, grammaticalCase: keyof typeof ARTICLE): string {
  const laws = [...new Set(row.norms.map((n) => n.citation).filter((c) => parseCitation(c).kind === "law"))];
  return laws.map((c) => lawRef(c, grammaticalCase)).join(", ");
}

// For «quotes» inside a sentence: shortened, without the clause's own full stop.
const clip = (s: string, n: number) => {
  const t = s.trim().replace(/[.;,]+$/, "");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};

export function employerLetter(review: ContractReview): string {
  const violations = review.clauses.filter((r) => r.verdict === "violation");
  const disputed = review.clauses.filter((r) => r.verdict === "disputed");
  const lines = [
    "Руководителю [наименование работодателя]",
    "[ФИО руководителя]",
    "от [ваше ФИО],",
    "[ваша должность]",
    "",
    "ЗАЯВЛЕНИЕ",
    "о приведении условий трудового договора в соответствие с законодательством Республики Казахстан",
    "",
    "Прошу рассмотреть условия моего трудового договора [№ и дата договора] и изменить пункты, которые, на мой взгляд, противоречат законодательству Республики Казахстан.",
  ];
  violations.forEach((r, i) => {
    const basis = refs(r, "dative");
    lines.push(
      "",
      `${i + 1}. Пункт ${r.clause_number}: «${clip(r.text, 400)}».`,
      `${basis ? `Условие противоречит ${basis}.` : "Условие противоречит законодательству."} ${sentence(r.explanation)}`,
    );
    if (r.fix) lines.push(`Прошу изложить пункт в редакции: «${clip(r.fix, 600)}».`);
  });
  if (disputed.length) {
    lines.push("", "Также прошу разъяснить следующие пункты, соответствие которых закону вызывает у меня вопросы:");
    for (const r of disputed) {
      const basis = refs(r, "genitive");
      lines.push(`— пункт ${r.clause_number} («${clip(r.text, 200)}»)${basis ? `, с учётом ${basis}` : ""}.`);
    }
  }
  lines.push(
    "",
    "Прошу сообщить о принятом решении в письменной форме.",
    "",
    "Дата: ____________          Подпись: ____________",
  );
  return lines.join("\n");
}

export function clauseQuestion(row: ReviewRow): string {
  const quote = `Пункт ${row.clause_number} моего трудового договора: «${clip(row.text, 1500)}».`;
  if (row.verdict === "violation") return `${quote} Проверка отметила его как нарушение. Что требует закон и как мне поступить?`;
  if (row.verdict === "disputed") return `${quote} Проверка отметила его как спорный. Что об этом говорит закон и на что обратить внимание?`;
  return `${quote} Что об этом говорит Трудовой кодекс РК?`;
}
