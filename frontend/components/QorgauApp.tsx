"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AskResponse, type Clause, type DocumentResponse } from "@/lib/api";
import type { Citation } from "@/lib/citations";
import { spring, springSnappy } from "@/lib/motion";
import { AnswerCard } from "./AnswerCard";
import { CitationView } from "./CitationView";
import { ACCEPT, Composer } from "./Composer";
import { DocumentCard } from "./DocumentCard";
import { SearchCompare } from "./SearchCompare";
import { Sheet } from "./Sheet";
import { Thinking } from "./Thinking";

type Item =
  | { id: string; kind: "question"; text: string; withDocument: string | null }
  | { id: string; kind: "document"; doc: DocumentResponse }
  | { id: string; kind: "pending"; startedAt: number; withDocument: boolean }
  | { id: string; kind: "answer"; answer: AskResponse; seconds: number }
  | { id: string; kind: "error"; message: string };

type Tab = "assistant" | "search";

const MAX_BYTES = 10 * 1024 * 1024;
const REVIEW_QUESTION = "Проверь мой трудовой договор на соответствие Трудовому кодексу РК.";
const EXAMPLES = [
  "Сколько дней ежегодного отпуска положено работнику?",
  "Какой максимальный испытательный срок?",
  "Как оплачивается сверхурочная работа?",
  "Что такое Курултай по Конституции?",
];

const uid = () => crypto.randomUUID();

export function QorgauApp() {
  const [tab, setTab] = useState<Tab>("assistant");
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; uploading: boolean; id?: string } | null>(null);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [dragging, setDragging] = useState(false);
  const sessionId = useRef<string>("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const busy = items.some((i) => i.kind === "pending");

  useEffect(() => {
    sessionId.current = `web-${uid()}`;
    api
      .health()
      .then((h) => setOnline(h.qdrant_connected && h.collection_exists))
      .catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    if (items.length) bottom.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  }, [items, reduced]);

  const openCitation = useCallback((c: Citation) => setCitation(c), []);
  const closeCitation = useCallback(() => setCitation(null), []);

  async function attach(file: File) {
    if (file.size > MAX_BYTES) {
      setItems((xs) => [...xs, { id: uid(), kind: "error", message: "Файл больше 10 МБ. Загрузите документ поменьше." }]);
      return;
    }
    setTab("assistant");
    setAttachment({ name: file.name, uploading: true });
    try {
      const doc = await api.upload(file);
      setAttachment({ name: doc.filename, uploading: false, id: doc.document_id });
      setClauses(doc.clauses);
      setItems((xs) => [...xs, { id: uid(), kind: "document", doc }]);
      setDraft((d) => d || REVIEW_QUESTION);
    } catch (e) {
      setAttachment(null);
      setItems((xs) => [...xs, { id: uid(), kind: "error", message: (e as Error).message }]);
    }
  }

  async function send(text = draft) {
    const question = text.trim() || (attachment ? REVIEW_QUESTION : "");
    if (!question || busy || attachment?.uploading) return;
    const pendingId = uid();
    const startedAt = Date.now();
    const docId = attachment?.id;
    setDraft("");
    setItems((xs) => [
      ...xs,
      { id: uid(), kind: "question", text: question, withDocument: docId ? attachment!.name : null },
      { id: pendingId, kind: "pending", startedAt, withDocument: !!docId },
    ]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const answer = await api.ask(question, sessionId.current, docId, controller.signal);
      const seconds = (Date.now() - startedAt) / 1000;
      setItems((xs) => xs.map((x) => (x.id === pendingId ? { id: pendingId, kind: "answer", answer, seconds } : x)));
    } catch (e) {
      const message = controller.signal.aborted ? "Запрос отменён." : (e as Error).message;
      setItems((xs) => xs.map((x) => (x.id === pendingId ? { id: pendingId, kind: "error", message } : x)));
    } finally {
      abort.current = null;
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && ACCEPT.split(",").includes(f.type)) attach(f);
  }

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="min-h-dvh"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        <Header tab={tab} onTab={setTab} online={online} />

        <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-48 sm:px-6">
          <AnimatePresence mode="wait" initial={false}>
            {tab === "assistant" ? (
              <motion.div
                key="assistant"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={springSnappy}
              >
                {items.length === 0 ? (
                  <Empty onPick={(q) => send(q)} disabled={online === false} />
                ) : (
                  <div className="space-y-4" aria-live="polite">
                    {items.map((item) => (
                      <motion.div
                        key={item.id}
                        layout="position"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={spring}
                      >
                        <ThreadItem
                          item={item}
                          onCite={openCitation}
                          onCancel={() => abort.current?.abort()}
                        />
                      </motion.div>
                    ))}
                  </div>
                )}
                <div ref={bottom} />
              </motion.div>
            ) : (
              <motion.div
                key="search"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={springSnappy}
              >
                <SearchCompare onCite={openCitation} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {tab === "assistant" && (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
            <div className="h-10 bg-gradient-to-t from-bg to-transparent" />
            <div className="pointer-events-auto bg-bg px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
              <div className="mx-auto max-w-3xl">
                <Composer
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => send()}
                  onAttach={attach}
                  onDetach={() => setAttachment(null)}
                  attachment={attachment}
                  busy={busy}
                  placeholder={attachment ? "Что проверить в договоре?" : "Спросите о трудовых правах"}
                />
                <p className="t-caption mt-2 px-3 text-center text-text-3">
                  ИИН, телефоны и счета скрываются до отправки в модель. Ответ — информация, а не юридическая консультация.
                </p>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence>
          {dragging && (
            <motion.div
              className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-[2rem] border-2 border-dashed border-accent-ink bg-accent-soft"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={springSnappy}
            >
              <p className="t-title text-accent-ink">Отпустите, чтобы загрузить договор</p>
            </motion.div>
          )}
        </AnimatePresence>

        <Sheet open={!!citation} onClose={closeCitation} label="Текст нормы">
          {citation && <CitationView citation={citation} clauses={clauses} />}
        </Sheet>
      </div>
    </MotionConfig>
  );
}

function ThreadItem({ item, onCite, onCancel }: { item: Item; onCite: (c: Citation) => void; onCancel: () => void }) {
  switch (item.kind) {
    case "question":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-[1.25rem] rounded-br-md bg-accent px-4 py-2.5 text-white">
            <p className="t-body whitespace-pre-line">{item.text}</p>
            {item.withDocument && <p className="t-caption mt-1 opacity-80">📎 {item.withDocument}</p>}
          </div>
        </div>
      );
    case "document":
      return <DocumentCard doc={item.doc} />;
    case "pending":
      return <Thinking startedAt={item.startedAt} withDocument={item.withDocument} onCancel={onCancel} />;
    case "answer":
      return <AnswerCard answer={item.answer} seconds={item.seconds} onCite={onCite} />;
    case "error":
      return (
        <div className="card t-body flex gap-3 p-5 text-text" role="alert">
          <span className="text-red" aria-hidden>
            ●
          </span>
          <span>{item.message}</span>
        </div>
      );
  }
}

function Empty({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="pt-6 sm:pt-12">
      <Logo size={72} />
      <p className="t-eyebrow mt-6 text-gold-ink">Конституция · Трудовой кодекс РК</p>
      <h1 className="t-display mt-2 max-w-xl">Трудовые права — со ссылкой на закон</h1>
      <p className="t-body mt-3 max-w-xl text-text-2">
        QorgauAI отвечает по Конституции (ред. 2026) и Трудовому кодексу Республики Казахстан. Каждое утверждение
        проверяется вторым агентом и открывается до текста статьи. Можно загрузить трудовой договор — PDF или фото.
      </p>
      <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            disabled={disabled}
            className="pressable card t-body p-4 text-left hover:bg-surface-2 disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function Header({ tab, onTab, online }: { tab: Tab; onTab: (t: Tab) => void; online: boolean | null }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "assistant", label: "Помощник" },
    { id: "search", label: "Поиск A/B" },
  ];
  return (
    <header className="material sticky top-0 z-30">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Logo size={30} />
          <span className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
            Qorgau<span className="text-gold-ink">AI</span>
          </span>
        </div>
        <nav className="mx-auto flex rounded-full bg-surface-2 p-0.5" aria-label="Разделы">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className="pressable t-caption relative rounded-full px-3.5 py-1.5 font-medium"
            >
              {tab === t.id && (
                <motion.span
                  layoutId="segment"
                  className="absolute inset-0 rounded-full bg-surface shadow-[var(--shadow-sm)]"
                  transition={springSnappy}
                />
              )}
              <span className={`relative ${tab === t.id ? "text-text" : "text-text-2"}`}>{t.label}</span>
            </button>
          ))}
        </nav>
        <span className="t-caption hidden items-center gap-1.5 text-text-2 sm:flex" title="Состояние бэкенда и Qdrant">
          <span
            className={`size-2 rounded-full ${online === null ? "bg-text-3" : online ? "bg-green" : "bg-red"}`}
            aria-hidden
          />
          {online === null ? "Подключение…" : online ? "База подключена" : "Бэкенд недоступен"}
        </span>
      </div>
    </header>
  );
}

// The emblem is navy and gold on transparent; in dark mode it sits on a light
// disc so the navy keeps its contrast.
function Logo({ size }: { size: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full dark:bg-white/95" style={{ width: size, height: size }}>
      <Image src="/logo-mark.png" alt="" width={size} height={size} priority className="dark:scale-[0.84]" />
    </span>
  );
}
