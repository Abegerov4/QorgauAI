import type { ChatSummary, Clause } from "./api";

// Conversations live on the server (GET/PUT /chats). The tab only remembers
// which one is open, so a reload brings the reader back to it; closing the
// tab starts from a new chat, as in any chat app.

const OPEN_KEY = "qorgau-open-chat";

export type SavedChat<T> = { sessionId: string; items: T[]; clauses: Clause[] };

export function rememberOpenChat(id: string | null) {
  try {
    if (id) sessionStorage.setItem(OPEN_KEY, id);
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    // blocked storage: a reload simply opens a new chat
  }
}

export function openChatId(): string | null {
  try {
    return sessionStorage.getItem(OPEN_KEY);
  } catch {
    return null;
  }
}

type TitleSource = { kind: string; text?: string; doc?: { filename: string } };

/** The first question names the chat; a chat that so far only holds an uploaded contract is named after the file. */
export function chatTitle(items: TitleSource[]): string {
  const question = items.find((i) => i.kind === "question")?.text;
  const doc = items.find((i) => i.kind === "document")?.doc?.filename;
  const title = (question ?? (doc ? `Договор: ${doc}` : "Новый чат")).replace(/\s+/g, " ").trim();
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

export type ChatGroup = { label: string; chats: ChatSummary[] };

/** Today / yesterday / this week / earlier, by the reader's local day. */
export function groupChats(chats: ChatSummary[], now = new Date()): ChatGroup[] {
  const day = 86_400_000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const bucket = (c: ChatSummary) => {
    const t = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(c.updated_at) ? c.updated_at : `${c.updated_at}Z`).getTime();
    if (t >= today) return "Сегодня";
    if (t >= today - day) return "Вчера";
    if (t >= today - 7 * day) return "Последние 7 дней";
    return "Ранее";
  };
  const groups: ChatGroup[] = [];
  for (const c of chats) {
    const label = bucket(c);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.chats.push(c);
    else groups.push({ label, chats: [c] });
  }
  return groups;
}
