"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AgentEvent, type AskResponse, type Clause, type DocumentResponse } from "@/lib/api";
import type { Citation } from "@/lib/citations";
import { spring, springSnappy } from "@/lib/motion";
import type { Trace } from "./AgentSteps";
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
  | { id: string; kind: "pending"; startedAt: number; withDocument: boolean; trace: Trace }
  | { id: string; kind: "answer"; answer: AskResponse; seconds: number }
  | { id: string; kind: "error"; message: string };

type Tab = "assistant" | "search";

const MAX_BYTES = 10 * 1024 * 1024;
const REVIEW_QUESTION = "Проверь мой трудовой договор на соответствие Трудовому кодексу РК.";
const EXAMPLES: { label: string; question: string; icon: React.ReactNode }[] = [
  {
    label: "Ежегодный отпуск",
    question: "Сколько дней ежегодного отпуска положено работнику?",
    icon: (
      <>
        <rect x="2" y="3" width="12" height="11" rx="2" />
        <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
      </>
    ),
  },
  {
    label: "Испытательный срок",
    question: "Какой максимальный испытательный срок?",
    icon: <path d="M4 1.5h8M4 14.5h8M4.5 1.5c0 3.5 3.5 4 3.5 6.5s-3.5 3-3.5 6.5M11.5 1.5c0 3.5-3.5 4-3.5 6.5s3.5 3 3.5 6.5" />,
  },
  {
    label: "Сверхурочные",
    question: "Как оплачивается сверхурочная работа?",
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 4.5V8l2.5 1.5" />
      </>
    ),
  },
  {
    label: "Курултай",
    question: "Что такое Курултай по Конституции?",
    icon: <path d="M2 6h12L8 2.5zM3.5 6v6M6.5 6v6M9.5 6v6M12.5 6v6M2 13.5h12" />,
  },
];

const uid = () => crypto.randomUUID();

function applyEvent(t: Trace, e: AgentEvent): Trace {
  if (e.type === "step") return { ...t, path: [...t.path, e.node], verified: e.node === "verify" ? [...t.verified, undefined] : t.verified };
  if (e.type === "tool") {
    return { ...t, tools: [...t.tools, { name: e.name, args: e.args, found: e.found, result: e.result, attempt: e.attempt }] };
  }
  return { ...t, verified: [...t.verified.slice(0, -1), { checked: e.checked, supported: e.supported }] };
}

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
      { id: pendingId, kind: "pending", startedAt, withDocument: !!docId, trace: { path: [], tools: [], verified: [] } },
    ]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const onEvent = (e: AgentEvent) =>
        setItems((xs) => xs.map((x) => (x.id === pendingId && x.kind === "pending" ? { ...x, trace: applyEvent(x.trace, e) } : x)));
      const answer = await api.askStream(question, sessionId.current, docId, onEvent, controller.signal);
      const seconds = (Date.now() - startedAt) / 1000;
      setItems((xs) => xs.map((x) => (x.id === pendingId ? { id: pendingId, kind: "answer", answer, seconds } : x)));
    } catch (e) {
      const message = controller.signal.aborted ? "Запрос отменён." : (e as Error).message;
      setItems((xs) => xs.map((x) => (x.id === pendingId ? { id: pendingId, kind: "error", message } : x)));
    } finally {
      abort.current = null;
    }
  }

  // An empty chat shows the composer under the heading; with the first
  // message it moves to the bottom bar (a shared layout animation).
  const hero = items.length === 0;
  const composer = (
    <motion.div layoutId="composer" transition={spring}>
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
    </motion.div>
  );

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
        {/* Shared by both tabs, so switching tabs never blinks it out. Full on
            the start screen, quieter behind content so it never competes with
            an answer or the search results. */}
        <motion.div
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: tab === "search" ? 0.6 : hero ? 1 : 0.35 }}
          transition={{ duration: 0.6 }}
          aria-hidden
        >
          <div className="aurora" />
        </motion.div>

        <Header tab={tab} onTab={setTab} online={online} />

        <main className={`mx-auto w-full max-w-3xl px-4 pt-8 sm:px-6 ${hero ? "pb-8" : "pb-60"}`}>
          {/* No initial={false} here: Motion passes it down to everything mounted
              inside later, which would skip the entrance of new messages and the
              word-by-word answer. */}
          <AnimatePresence mode="wait">
            {tab === "assistant" ? (
              <motion.div
                key="assistant"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={springSnappy}
              >
                {/* One continuous screen: with the first question the intro
                    shrinks into a compact heading and the thread grows under it,
                    instead of the start screen being swapped for another. */}
                <div className={hero ? "flex min-h-[calc(100dvh-7.5rem)] flex-col justify-center" : ""}>
                  <div className="relative">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {hero ? (
                        <motion.div
                          key="intro"
                          exit={{ opacity: 0, y: -48, scale: 0.96 }}
                          transition={spring}
                          className="w-full"
                        >
                          <Intro />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="intro-compact"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...spring, delay: 0.08 }}
                        >
                          <IntroCompact />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {hero && (
                    <>
                      <div className="mt-8">{composer}</div>
                      <Suggestions onPick={(q) => send(q)} disabled={online === false} className="mt-4 justify-center" />
                      <Disclaimer />
                    </>
                  )}
                </div>
                {!hero && (
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

        {tab === "assistant" && !hero && (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
            <div className="h-10 bg-gradient-to-t from-bg to-transparent" />
            <div className="pointer-events-auto bg-bg pb-[max(1rem,env(safe-area-inset-bottom))]">
              {/* Same box as <main>, so the composer lines up with the chat column. */}
              <div className="mx-auto max-w-3xl px-4 sm:px-6">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...spring, delay: 0.2 }}>
                  <Suggestions
                    onPick={(q) => send(q)}
                    disabled={online === false || busy}
                    compact
                    className="mb-2"
                  />
                </motion.div>
                {composer}
                <Disclaimer />
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
      return (
        <Thinking startedAt={item.startedAt} withDocument={item.withDocument} trace={item.trace} onCite={onCite} onCancel={onCancel} />
      );
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

function Intro() {
  return (
    <div className="flex flex-col items-center text-center">
      <Logo size={64} />
      <p className="t-eyebrow mt-5 text-gold-ink">Конституция · Трудовой кодекс РК</p>
      <h1 className="t-display mt-2 max-w-xl text-balance">Трудовые права — со ссылкой на закон</h1>
      <p className="t-body mt-3 max-w-lg text-balance text-text-2">
        Каждое утверждение проверяется вторым агентом и открывается до текста статьи.
      </p>
    </div>
  );
}

// What the intro becomes once the conversation starts: it stays at the top of
// the thread and scrolls away with it.
function IntroCompact() {
  return (
    <div className="mb-6 flex items-center gap-3 border-b border-hairline pb-5">
      <Logo size={40} />
      <div className="min-w-0">
        <p className="t-eyebrow text-gold-ink">Конституция · Трудовой кодекс РК</p>
        <h1 className="t-title mt-0.5">Трудовые права — со ссылкой на закон</h1>
      </div>
    </div>
  );
}

function Suggestions({
  onPick,
  disabled,
  compact = false,
  className,
}: {
  onPick: (q: string) => void;
  disabled: boolean;
  compact?: boolean;
  className: string;
}) {
  // Above the bottom composer the chips stay on one line and scroll sideways.
  const size = compact ? "px-2.5 py-1.5" : "px-3 py-2";
  const row = compact ? "no-scrollbar flex-nowrap overflow-x-auto" : "flex-wrap";
  return (
    <div className={`flex gap-1.5 ${row} ${className}`}>
      {EXAMPLES.map((e) => (
        <button
          key={e.label}
          onClick={() => onPick(e.question)}
          disabled={disabled}
          title={e.question}
          className={`pressable t-caption inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface font-medium text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-50 ${size}`}
        >
          <PillIcon className="text-accent-ink">{e.icon}</PillIcon>
          {e.label}
        </button>
      ))}
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="t-caption mt-3 px-3 text-center text-text-3">
      ИИН, телефоны и счета скрываются до отправки в модель. Ответ — информация, а не юридическая консультация.
    </p>
  );
}

function PillIcon({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {children}
    </svg>
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
