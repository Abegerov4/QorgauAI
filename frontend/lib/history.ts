import type { Clause } from "./api";

// The conversation survives a page reload but not closing the tab: questions
// may hold an IIN or a phone number (masked only on the server), so they are
// kept in sessionStorage, never in localStorage. Storage can be unavailable
// (private mode, blocked site data): the chat then simply starts empty.

const KEY = "qorgau-chat-v1";

export type SavedChat<T> = { sessionId: string; items: T[]; clauses: Clause[] };

export function loadChat<T>(): SavedChat<T> | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as SavedChat<T>) : null;
    return data && Array.isArray(data.items) ? data : null;
  } catch {
    return null;
  }
}

export function saveChat<T>(chat: SavedChat<T>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(chat));
  } catch {
    // quota or blocked storage: history is a convenience, the chat still works
  }
}

export function clearChat() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
