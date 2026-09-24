import type { AskResponse } from "./api";

const STATUS: Record<AskResponse["status"], string> = {
  answered: "подтверждено нормами",
  partial: "подтверждено частично",
  refused: "нет подтверждённого ответа",
};

/** The answer as plain text with full citations, ready to paste into a letter or a claim. */
export function answerAsText(answer: AskResponse, question?: string): string {
  const lines: string[] = [];
  if (question) lines.push(`Вопрос: ${question}`, "");
  lines.push(`Ответ QorgauAI (${STATUS[answer.status]}):`);
  if (answer.claims.length === 0) {
    lines.push(answer.answer);
  } else {
    answer.claims.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.text}`);
      for (const s of c.sources) lines.push(`   — ${s}`);
    });
  }
  if (answer.missing_info.length) {
    lines.push("", "Что осталось за рамками ответа:", ...answer.missing_info.map((m) => `– ${m}`));
  }
  if (answer.recommend_lawyer) {
    lines.push("", "Ситуация спорная или с высокой ценой ошибки — стоит показать её практикующему юристу.");
  }
  lines.push("", answer.disclaimer);
  return lines.join("\n");
}
