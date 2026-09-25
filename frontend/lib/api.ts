// Typed client for the FastAPI backend (backend/app/api). The browser calls the
// backend directly (CORS is open) instead of a Next rewrite: /ask can take
// 20-60 s, longer than a dev proxy is happy to wait.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type AnswerStatus = "answered" | "partial" | "refused";

export type AnswerClaim = { text: string; sources: string[] };

export type ToolCall = {
  name: "search_legal_corpus" | "get_article" | "calculate_vacation_days" | string;
  args: Record<string, unknown>;
  found: string[];
  result: string | null;
  attempt: number;
};

export type AskResponse = {
  status: AnswerStatus;
  answer: string;
  claims: AnswerClaim[];
  sources: string[];
  missing_info: string[];
  removed_claims: string[];
  recommend_lawyer: boolean;
  disclaimer: string;
  path: string[];
  attempts: number;
  tool_calls: ToolCall[];
  checked_claims: number;
  supported_claims: number;
  trace_id: string | null;
};

export type Me = { email: string; name: string | null; role: "user" | "admin"; questions_today: number; daily_limit: number | null };

/** A saved conversation in the sidebar; updated_at is UTC without a zone. */
export type ChatSummary = { id: string; title: string; updated_at: string };

export type AdminStats = {
  today: { spent_usd: number; budget_usd: number; per_user_limit: number; users: { email: string; questions: number; cost_usd: number }[] };
  week: { questions: number; cost_usd: number; active_users: number; helpful: number; not_helpful: number };
  users_total: number;
  negative_feedback: {
    trace_id: string;
    trace_url: string | null;
    comment: string | null;
    created_at: string;
    user_email: string;
    question: string | null;
  }[];
};

/** Live progress of /ask/stream. */
export type AgentEvent =
  | { type: "step"; node: string }
  | ({ type: "tool" } & ToolCall)
  | { type: "verified"; checked: number; supported: number };

export type Clause = { clause_number: string; topic: string; text: string };

export type DocumentResponse = {
  document_id: string;
  filename: string;
  document_type: string;
  pages: { page: number; method: "text_layer" | "vision"; chars: number }[];
  pii_found: string[];
  clauses: Clause[];
};

export type ArticleResponse = {
  code: string;
  chapter: string;
  article: string;
  article_number: string;
  points: { point: string; text: string }[];
};

export type SearchChunk = {
  text: string;
  code: string;
  chapter: string;
  article: string;
  article_number: string;
  point: string;
  chunk_type: string;
  source: string;
  score: number;
};

export type SearchResponse = { query: string; pipeline: "dense" | "hybrid"; results: SearchChunk[] };

export type Health = { status: string; qdrant_connected: boolean; collection_exists: boolean };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The API accepts a short-lived token signed by this web app (/api/token) for
// the signed-in user. Cached until a minute before it expires; in the open
// local mode /api/token answers 204 and requests go without one.
let cached: { token: string | null; expiresAt: number } | null = null;

async function authHeaders(): Promise<Record<string, string>> {
  const now = Date.now() / 1000;
  if (!cached || (cached.token && cached.expiresAt - 60 < now)) {
    const resp = await fetch("/api/token", { cache: "no-store" });
    if (resp.status === 401) throw new ApiError(401, "Сессия истекла. Обновите страницу и войдите снова.");
    cached = resp.status === 204 ? { token: null, expiresAt: Infinity } : ((await resp.json()) as { token: string; expiresAt: number });
  }
  return cached.token ? { Authorization: `Bearer ${cached.token}` } : {};
}

function withAuth(init: RequestInit | undefined, headers: Record<string, string>): RequestInit {
  return { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), ...headers } };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  let resp: Response;
  try {
    resp = await fetch(API_URL + path, withAuth(init, headers));
  } catch {
    throw new ApiError(0, `Сервер недоступен (${API_URL}). Попробуйте через минуту.`);
  }
  if (!resp.ok) {
    let detail = `Ошибка сервера (${resp.status})`;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {}
    throw new ApiError(resp.status, detail);
  }
  return (resp.status === 204 ? undefined : resp.json()) as Promise<T>;
}

async function* sseEvents(resp: Response): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = resp.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = block.match(/^event: (.*)$/m)?.[1] ?? "message";
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  // Public: the header shows it before (and without) sign-in.
  health: async () => {
    const resp = await fetch(API_URL + "/health");
    if (!resp.ok) throw new ApiError(resp.status, "Бэкенд недоступен");
    return (await resp.json()) as Health;
  },
  ask: (question: string, sessionId: string, documentId?: string, signal?: AbortSignal) =>
    request<AskResponse>("/ask", { ...json({ question, session_id: sessionId, document_id: documentId }), signal }),
  /** Pipeline C with live progress: Server-Sent Events over a POST. */
  askStream: async (
    question: string,
    sessionId: string,
    documentId: string | undefined,
    onEvent: (e: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<AskResponse> => {
    let resp: Response;
    try {
      resp = await fetch(
        API_URL + "/ask/stream",
        withAuth({ ...json({ question, session_id: sessionId, document_id: documentId }), signal }, await authHeaders()),
      );
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ApiError(0, `Сервер недоступен (${API_URL}). Попробуйте через минуту.`);
    }
    if (!resp.ok || !resp.body) {
      let detail = `Ошибка сервера (${resp.status})`;
      try {
        const body = await resp.json();
        if (typeof body.detail === "string") detail = body.detail;
      } catch {}
      throw new ApiError(resp.status, detail);
    }
    for await (const { event, data } of sseEvents(resp)) {
      if (event === "final") return data as AskResponse;
      if (event === "error") throw new ApiError(500, "Агент завершился с ошибкой. Попробуйте ещё раз.");
      onEvent({ type: event, ...(data as object) } as AgentEvent);
    }
    throw new ApiError(500, "Соединение прервалось до ответа.");
  },
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<DocumentResponse>("/documents", { method: "POST", body: form });
  },
  article: (codeKey: string, number: string) =>
    request<ArticleResponse>(`/articles/${codeKey}/${encodeURIComponent(number)}`),
  search: (query: string, pipeline: "dense" | "hybrid", topK = 5) =>
    request<SearchResponse>("/search", json({ query, pipeline, top_k: topK })),
  me: () => request<Me>("/me"),
  feedback: (traceId: string, helpful: boolean, comment?: string) =>
    request<void>("/feedback", json({ trace_id: traceId, helpful, comment: comment || undefined })),
  chats: () => request<ChatSummary[]>("/chats"),
  chat: <T>(id: string) => request<{ id: string; title: string; chat: T }>(`/chats/${encodeURIComponent(id)}`),
  saveChat: (id: string, title: string, chat: unknown) =>
    request<void>(`/chats/${encodeURIComponent(id)}`, { ...json({ title, chat }), method: "PUT" }),
  deleteChat: (id: string) => request<void>(`/chats/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adminStats: () => request<AdminStats>("/admin/stats"),
};
