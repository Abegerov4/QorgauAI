import type { AskResponse } from "./api";
import type { Dict } from "./dict";

/** The answer as plain text with full citations, ready to paste into a letter or a claim. */
export function answerAsText(answer: AskResponse, t: Dict, question?: string): string {
  const status = { answered: t.statusAnswered, partial: t.statusPartial, refused: t.statusRefused }[answer.status];
  const lines: string[] = [];
  if (question) lines.push(`${t.copyQuestion}: ${question}`, "");
  lines.push(t.copyAnswerHead(status.toLowerCase()));
  if (answer.claims.length === 0) {
    lines.push(answer.answer);
  } else {
    answer.claims.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.text}`);
      for (const s of c.sources) lines.push(`   — ${s}`);
    });
  }
  if (answer.missing_info.length) {
    lines.push("", `${t.missing}:`, ...answer.missing_info.map((m) => `– ${m}`));
  }
  if (answer.recommend_lawyer) {
    lines.push("", t.lawyer);
  }
  lines.push("", answer.disclaimer);
  return lines.join("\n");
}
