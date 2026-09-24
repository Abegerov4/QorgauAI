// Typed client for the FastAPI backend (backend/app/api). The browser calls the
// backend directly (CORS is open) instead of a Next rewrite: /ask can take
// 20-60 s, longer than a dev proxy is happy to wait.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type AnswerStatus = "answered" | "partial" | "refused";

export type AnswerClaim = { text: string; sources: string[] };

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
};

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(API_URL + path, init);
  } catch {
    throw new ApiError(0, `Бэкенд недоступен по адресу ${API_URL}. Запустите uvicorn из папки backend.`);
  }
  if (!resp.ok) {
    let detail = `Ошибка сервера (${resp.status})`;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {}
    throw new ApiError(resp.status, detail);
  }
  return resp.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<Health>("/health"),
  ask: (question: string, sessionId: string, documentId?: string, signal?: AbortSignal) =>
    request<AskResponse>("/ask", { ...json({ question, session_id: sessionId, document_id: documentId }), signal }),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<DocumentResponse>("/documents", { method: "POST", body: form });
  },
  article: (codeKey: string, number: string) =>
    request<ArticleResponse>(`/articles/${codeKey}/${encodeURIComponent(number)}`),
  search: (query: string, pipeline: "dense" | "hybrid", topK = 5) =>
    request<SearchResponse>("/search", json({ query, pipeline, top_k: topK })),
};
