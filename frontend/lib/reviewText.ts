// Plain-text pieces built from a finished contract review: the employer letter
// and the question for "ask about this clause". Built from the verdicts alone,
// so nothing here can cite a norm the review did not find.

import type { ContractReview, ReviewRow } from "./api";
import { parseCitation } from "./citations";
import type { Dict, Lang } from "./dict";

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

// Points of a citation: "Пункт 1, подпункт 2)" -> { point: "1", sub: "2" }.
function pointsOf(point: string): { point?: string; sub?: string } {
  return {
    point: point.match(/Пункт\s+([^,]+)/i)?.[1].trim(),
    sub: point.match(/подпункт\s+([^,]+)/i)?.[1].trim().replace(/\)$/, ""),
  };
}

/** Kazakh: "ҚР Еңбек кодексінің 36-бабының 2-тармағына" (dative) or "...тармағын" (accusative). */
function kkRef(raw: string, grammaticalCase: "dative" | "accusative"): string {
  const c = parseCitation(raw);
  if (c.kind !== "law") return raw;
  const code = c.codeKey === "constitution" ? "ҚР Конституциясының" : "ҚР Еңбек кодексінің";
  const { point, sub } = pointsOf(c.point);
  const end = grammaticalCase === "dative" ? { article: "бабына", point: "тармағына", sub: "тармақшасына" } : { article: "бабын", point: "тармағын", sub: "тармақшасын" };
  if (!point) return `${code} ${c.article}-${end.article}`;
  if (!sub) return `${code} ${c.article}-бабының ${point}-${end.point}`;
  return `${code} ${c.article}-бабының ${point}-тармағының ${sub}-${end.sub}`;
}

/** English: "Article 36 (paragraph 2) of the Labor Code of the Republic of Kazakhstan". */
function enRef(raw: string): string {
  const c = parseCitation(raw);
  if (c.kind !== "law") return raw;
  const code = c.codeKey === "constitution" ? "the Constitution of the Republic of Kazakhstan" : "the Labor Code of the Republic of Kazakhstan";
  const { point, sub } = pointsOf(c.point);
  const where = [point && `paragraph ${point}`, sub && `subparagraph ${sub}`].filter(Boolean).join(", ");
  return `Article ${c.article}${where ? ` (${where})` : ""} of ${code}`;
}

function lawsOf(row: ReviewRow): string[] {
  return [...new Set(row.norms.map((n) => n.citation).filter((c) => parseCitation(c).kind === "law"))];
}

type LetterParts = {
  head: string[];
  item: (i: number, row: ReviewRow) => string[];
  disputedIntro: string;
  disputedItem: (row: ReviewRow) => string;
  tail: string[];
};

const LETTERS: Record<Lang, LetterParts> = {
  ru: {
    head: [
      "Руководителю [наименование работодателя]",
      "[ФИО руководителя]",
      "от [ваше ФИО],",
      "[ваша должность]",
      "",
      "ЗАЯВЛЕНИЕ",
      "о приведении условий трудового договора в соответствие с законодательством Республики Казахстан",
      "",
      "Прошу рассмотреть условия моего трудового договора [№ и дата договора] и изменить пункты, которые, на мой взгляд, противоречат законодательству Республики Казахстан.",
    ],
    item: (i, r) => {
      const basis = refs(r, "dative");
      return [
        `${i + 1}. Пункт ${r.clause_number}: «${clip(r.text, 400)}».`,
        `${basis ? `Условие противоречит ${basis}.` : "Условие противоречит законодательству."} ${sentence(r.explanation)}`,
        ...(r.fix ? [`Прошу изложить пункт в редакции: «${clip(r.fix, 600)}».`] : []),
      ];
    },
    disputedIntro: "Также прошу разъяснить следующие пункты, соответствие которых закону вызывает у меня вопросы:",
    disputedItem: (r) => {
      const basis = refs(r, "genitive");
      return `— пункт ${r.clause_number} («${clip(r.text, 200)}»)${basis ? `, с учётом ${basis}` : ""}.`;
    },
    tail: ["Прошу сообщить о принятом решении в письменной форме.", "", "Дата: ____________          Подпись: ____________"],
  },
  kk: {
    head: [
      "[Жұмыс берушінің атауы] басшысына",
      "[Басшының аты-жөні]",
      "[Сіздің аты-жөніңіз],",
      "[лауазымыңыз]",
      "",
      "ӨТІНІШ",
      "еңбек шартының талаптарын Қазақстан Республикасының заңнамасына сәйкес келтіру туралы",
      "",
      "[Шарттың нөмірі мен күні] еңбек шартымның талаптарын қарап, менің ойымша Қазақстан Республикасының заңнамасына қайшы келетін тармақтарды өзгертуіңізді сұраймын.",
    ],
    item: (i, r) => {
      const laws = lawsOf(r);
      const basis = laws.map((c) => kkRef(c, "dative")).join(", ");
      return [
        `${i + 1}. ${r.clause_number}-тармақ: «${clip(r.text, 400)}».`,
        `${basis ? `Бұл талап ${basis} қайшы келеді.` : "Бұл талап заңнамаға қайшы келеді."} ${sentence(r.explanation)}`,
        ...(r.fix ? [`Тармақты мына редакцияда жазуды сұраймын: «${clip(r.fix, 600)}».`] : []),
      ];
    },
    disputedIntro: "Сондай-ақ заңға сәйкестігі менде сұрақ туғызатын мына тармақтарды түсіндіруіңізді сұраймын:",
    disputedItem: (r) => {
      const basis = lawsOf(r).map((c) => kkRef(c, "accusative")).join(", ");
      return `— ${r.clause_number}-тармақ («${clip(r.text, 200)}»)${basis ? `, ${basis} ескере отырып` : ""}.`;
    },
    tail: ["Қабылданған шешім туралы маған жазбаша хабарлауыңызды сұраймын.", "", "Күні: ____________          Қолы: ____________"],
  },
  en: {
    head: [
      "To: [Head of the employer's organization]",
      "[Full name of the head]",
      "From: [Your full name],",
      "[Your position]",
      "",
      "REQUEST",
      "to bring the terms of my employment contract into line with the law of the Republic of Kazakhstan",
      "",
      "I ask you to review the terms of my employment contract [number and date] and to amend the clauses that, in my view, contradict the law of the Republic of Kazakhstan.",
    ],
    item: (i, r) => {
      const basis = lawsOf(r).map(enRef).join(", ");
      return [
        `${i + 1}. Clause ${r.clause_number}: "${clip(r.text, 400)}".`,
        `${basis ? `This term contradicts ${basis}.` : "This term contradicts the law."} ${sentence(r.explanation)}`,
        ...(r.fix ? [`I ask that the clause read as follows: "${clip(r.fix, 600)}".`] : []),
      ];
    },
    disputedIntro: "I also ask you to clarify the following clauses, whose compliance with the law raises questions for me:",
    disputedItem: (r) => {
      const basis = lawsOf(r).map(enRef).join(", ");
      return `— clause ${r.clause_number} ("${clip(r.text, 200)}")${basis ? `, in light of ${basis}` : ""}.`;
    },
    tail: ["Please inform me of your decision in writing.", "", "Date: ____________          Signature: ____________"],
  },
};

/** A draft request to the employer in the reader's language; clause texts and the suggested wording stay as in the contract. */
export function employerLetter(review: ContractReview, lang: Lang = "ru"): string {
  const L = LETTERS[lang];
  const violations = review.clauses.filter((r) => r.verdict === "violation");
  const disputed = review.clauses.filter((r) => r.verdict === "disputed");
  const lines = [...L.head];
  violations.forEach((r, i) => lines.push("", ...L.item(i, r)));
  if (disputed.length) {
    lines.push("", L.disputedIntro);
    for (const r of disputed) lines.push(L.disputedItem(r));
  }
  lines.push("", ...L.tail);
  return lines.join("\n");
}

export function clauseQuestion(row: ReviewRow, t: Dict): string {
  const quote = t.clauseAsk.quote(row.clause_number, clip(row.text, 1500));
  if (row.verdict === "violation") return `${quote} ${t.clauseAsk.violation}`;
  if (row.verdict === "disputed") return `${quote} ${t.clauseAsk.disputed}`;
  return `${quote} ${t.clauseAsk.ok}`;
}
