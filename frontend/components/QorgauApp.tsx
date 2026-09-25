"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions";
import { api, type AgentEvent, type AskResponse, type Clause, type DocumentResponse, type Me } from "@/lib/api";
import type { Citation } from "@/lib/citations";
import { clearChat, loadChat, saveChat, type SavedChat } from "@/lib/history";
import { spring, springSnappy } from "@/lib/motion";
import type { Trace } from "./AgentSteps";
import { AnswerCard } from "./AnswerCard";
import { CitationView } from "./CitationView";
import { ACCEPT, Composer } from "./Composer";
import { DocumentCard } from "./DocumentCard";
import { SearchCompare } from "./SearchCompare";
import { Sheet } from "./Sheet";
import { Thinking } from "./Thinking";
import { WordRotate } from "./WordRotate";

type Item =
  | { id: string; kind: "question"; text: string; withDocument: string | null }
  | { id: string; kind: "document"; doc: DocumentResponse }
  | { id: string; kind: "pending"; startedAt: number; withDocument: boolean; trace: Trace }
  | { id: string; kind: "answer"; answer: AskResponse; seconds: number; fresh?: boolean; feedback?: "up" | "down" }
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

// After a reload: an answer that was still being prepared cannot be picked up
// again, and restored answers show at once instead of typing themselves out.
function restoreItems(items: Item[]): Item[] {
  return items.map((x) =>
    x.kind === "pending"
      ? { id: x.id, kind: "error", message: "Ответ не дождался: страница была обновлена. Задайте вопрос ещё раз." }
      : x.kind === "answer"
        ? { ...x, fresh: false }
        : x,
  );
}

function applyEvent(t: Trace, e: AgentEvent): Trace {
  if (e.type === "step") return { ...t, path: [...t.path, e.node], verified: e.node === "verify" ? [...t.verified, undefined] : t.verified };
  if (e.type === "tool") {
    return { ...t, tools: [...t.tools, { name: e.name, args: e.args, found: e.found, result: e.result, attempt: e.attempt }] };
  }
  return { ...t, verified: [...t.verified.slice(0, -1), { checked: e.checked, supported: e.supported }] };
}

export type SignedInUser = { name: string | null; email: string; image: string | null };

export function QorgauApp({ user, authEnabled }: { user: SignedInUser | null; authEnabled: boolean }) {
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
  const restored = useRef(false);
  const [me, setMe] = useState<Me | null>(null);
  const [away, setAway] = useState(false); // scrolled up from the latest message
  const reduced = useReducedMotion();

  const busy = items.some((i) => i.kind === "pending");

  useEffect(() => {
    // Signed in: the conversation lives on the server, on any device. Open
    // local mode: in this tab's sessionStorage. Either way it is read after
    // the first render (the server-rendered page is always the empty chat).
    const apply = (saved: SavedChat<Item> | null) => {
      sessionId.current = saved?.sessionId ?? `web-${uid()}`;
      if (saved?.items?.length) {
        setItems(restoreItems(saved.items));
        setClauses(saved.clauses ?? []);
      }
      restored.current = true;
    };
    if (authEnabled) {
      api
        .history<SavedChat<Item>>()
        .then((r) => apply(r.chat))
        .catch(() => apply(null));
    } else {
      apply(loadChat<Item>());
    }
    api.me().then(setMe).catch(() => setMe(null));
    api
      .health()
      .then((h) => setOnline(h.qdrant_connected && h.collection_exists))
      .catch(() => setOnline(false));
  }, [authEnabled]);

  // To the very end of the page: main's bottom padding is what lifts the last
  // message above the fixed composer bar, so scrolling to the thread's last
  // element would leave it under the bar.
  const scrollToEnd = useCallback(
    () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced ? "auto" : "smooth" }),
    [reduced],
  );

  useEffect(() => {
    if (items.length) scrollToEnd();
  }, [items, scrollToEnd]);

  useEffect(() => {
    if (!restored.current) return; // do not overwrite the history before it is read
    const chat = items.length ? { sessionId: sessionId.current, items, clauses } : null;
    if (!authEnabled) {
      if (chat) saveChat(chat);
      else clearChat();
      return;
    }
    // Live progress changes items many times a second; save once it settles.
    const t = setTimeout(() => api.saveHistory(chat).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [items, clauses, authEnabled]);

  // "Back to the latest message" appears once the reader scrolls well up.
  useEffect(() => {
    const check = () => setAway(document.documentElement.scrollHeight - window.scrollY - window.innerHeight > 400);
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [items]);

  function newChat() {
    abort.current?.abort();
    setItems([]);
    setClauses([]);
    setAttachment(null);
    setDraft("");
    setCitation(null);
    sessionId.current = `web-${uid()}`;
    window.scrollTo({ top: 0 });
  }

  const rate = useCallback(async (itemId: string, traceId: string, helpful: boolean, comment?: string) => {
    const mark = (value: "up" | "down" | undefined) =>
      setItems((xs) => xs.map((x) => (x.id === itemId && x.kind === "answer" ? { ...x, feedback: value } : x)));
    mark(helpful ? "up" : "down"); // optimistic; undone if the API refuses
    try {
      await api.feedback(traceId, helpful, comment);
    } catch {
      mark(undefined);
    }
  }, []);

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
      setItems((xs) => xs.map((x) => (x.id === pendingId ? { id: pendingId, kind: "answer", answer, seconds, fresh: true } : x)));
      setMe((m) => (m ? { ...m, questions_today: m.questions_today + 1 } : m));
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

        <Header tab={tab} onTab={setTab} online={online} onNewChat={items.length > 0 ? newChat : undefined} user={user} me={me} />

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
                      <HowItWorks />
                      <Disclaimer />
                    </>
                  )}
                </div>
                {!hero && (
                  <div className="space-y-4" aria-live="polite">
                    {items.map((item, i) => (
                      <motion.div
                        key={item.id}
                        layout="position"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={spring}
                      >
                        <ThreadItem
                          item={item}
                          question={questionBefore(items, i)}
                          onRate={rate}
                          onCite={openCitation}
                          onCancel={() => abort.current?.abort()}
                        />
                      </motion.div>
                    ))}
                  </div>
                )}
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
            <div className="absolute inset-x-0 -top-4 flex justify-center">
              <AnimatePresence>
                {away && (
                  <motion.button
                    onClick={scrollToEnd}
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.9 }}
                    transition={springSnappy}
                    className="material-thick pressable pointer-events-auto grid size-10 place-items-center rounded-full text-text-2 hover:text-text"
                    aria-label="К последнему ответу"
                    title="К последнему ответу"
                  >
                    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
                      <path d="M7 1.5V14M1.5 8.5L7 14l5.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
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

function questionBefore(items: Item[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const x = items[i];
    if (x.kind === "question") return x.text;
  }
}

type ThreadItemProps = {
  item: Item;
  question?: string;
  onCite: (c: Citation) => void;
  onCancel: () => void;
  onRate: (itemId: string, traceId: string, helpful: boolean, comment?: string) => void;
};

function ThreadItem({ item, question, onCite, onCancel, onRate }: ThreadItemProps) {
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
      return (
        <AnswerCard
          answer={item.answer}
          seconds={item.seconds}
          onCite={onCite}
          question={question}
          fresh={!!item.fresh}
          feedback={item.feedback}
          onRate={(helpful, comment) => item.answer.trace_id && onRate(item.id, item.answer.trace_id, helpful, comment)}
        />
      );
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

const TOPICS = [
  "с ежегодным отпуском?",
  "с испытательным сроком?",
  "со сверхурочной работой?",
  "с трудовым договором?",
  "с вопросом по Конституции?",
];

const STEPS = [
  { title: "Спросите своими словами", text: "Или загрузите трудовой договор — PDF или фото" },
  { title: "Агент найдёт нормы", text: "В Трудовом кодексе и Конституции РК" },
  { title: "Второй агент проверит", text: "Каждое утверждение — по тексту статьи" },
];

// The brand is already in the header, so the start screen does not repeat it:
// it says what the assistant covers and asks what the user needs.
function Intro() {
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="t-display max-w-2xl">
        Чем могу помочь
        <br />
        <WordRotate words={TOPICS} still="с трудовыми правами?" className="text-accent-ink" />
      </h1>
      <p className="t-body mt-3 max-w-lg text-balance text-text-2">
        Отвечаю по Конституции и Трудовому кодексу РК — со ссылкой на каждую статью.
      </p>
    </div>
  );
}

function HowItWorks() {
  return (
    <ol className="mt-8 grid gap-2 text-left sm:grid-cols-3" aria-label="Как это работает">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex gap-3 rounded-2xl border border-hairline bg-surface/60 p-3.5 backdrop-blur sm:flex-col sm:gap-2">
          <span className="t-caption grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent-ink tabular-nums">
            {i + 1}
          </span>
          <span>
            <span className="t-caption block font-semibold text-text">{s.title}</span>
            <span className="t-caption block text-text-2">{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// What the intro becomes once the conversation starts: a quiet line at the
// top of the thread (no second logo), scrolling away with it.
function IntroCompact() {
  return (
    <p className="t-caption mb-6 border-b border-hairline pb-4 text-text-3">
      Отвечаю по Конституции и Трудовому кодексу РК. Каждое утверждение проверяет второй агент.
    </p>
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

type HeaderProps = {
  tab: Tab;
  onTab: (t: Tab) => void;
  online: boolean | null;
  onNewChat?: () => void;
  user: SignedInUser | null;
  me: Me | null;
};

function Header({ tab, onTab, online, onNewChat, user, me }: HeaderProps) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "assistant", label: "Помощник" },
    { id: "search", label: "Поиск A/B" },
  ];
  return (
    <header className="material sticky top-0 z-30">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Logo size={30} />
          {/* On the narrowest phones the emblem alone leaves room for the tabs
              and the new-chat button; the name is still the page title. */}
          <span className="hidden text-[1.0625rem] font-semibold tracking-[-0.01em] min-[420px]:inline">
            Qorgau<span className="text-gold-ink">AI</span>
          </span>
        </div>
        <nav className="mx-auto flex rounded-full bg-surface-2 p-0.5" aria-label="Разделы">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className="pressable t-caption relative rounded-full px-3 py-1.5 font-medium whitespace-nowrap sm:px-3.5"
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
        <AnimatePresence initial={false}>
          {onNewChat && (
            <motion.button
              onClick={() => {
                onTab("assistant");
                onNewChat();
              }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={springSnappy}
              className="pressable t-caption inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1.5 font-medium text-text hover:bg-accent-soft hover:text-accent-ink"
              aria-label="Новый чат"
              title="Начать новый чат"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">Новый чат</span>
            </motion.button>
          )}
        </AnimatePresence>
        <span
          className={`t-caption hidden items-center gap-1.5 text-text-2 ${user ? "lg:flex" : "sm:flex"}`}
          title="Состояние бэкенда и Qdrant"
        >
          <span
            className={`size-2 rounded-full ${online === null ? "bg-text-3" : online ? "bg-green" : "bg-red"}`}
            aria-hidden
          />
          {online === null ? "Подключение…" : online ? "База подключена" : "Бэкенд недоступен"}
        </span>
        {user && <UserMenu user={user} me={me} />}
      </div>
    </header>
  );
}

function UserMenu({ user, me }: { user: SignedInUser; me: Me | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => root.current?.contains(e.target as Node) || setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const initial = (user.name || user.email).trim()[0]?.toUpperCase() ?? "?";

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Меню аккаунта"
        className="pressable grid size-8 place-items-center overflow-hidden rounded-full bg-accent-soft font-semibold text-accent-ink"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Google avatar; next/image would need its host allow-listed
          <img src={user.image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <span className="t-caption">{initial}</span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={springSnappy}
            className="material-thick absolute top-10 right-0 z-40 w-64 origin-top-right rounded-2xl p-2"
          >
            <div className="px-2.5 pt-1.5 pb-2.5">
              <p className="t-body truncate font-semibold">{user.name ?? user.email}</p>
              <p className="t-caption truncate text-text-2">{user.email}</p>
              {me && (
                <p className="t-caption mt-1.5 text-text-3">
                  {me.daily_limit === null
                    ? `Администратор · сегодня вопросов: ${me.questions_today}`
                    : `Сегодня осталось ${Math.max(0, me.daily_limit - me.questions_today)} из ${me.daily_limit} вопросов`}
                </p>
              )}
            </div>
            <div className="border-t border-hairline pt-1.5">
              {me?.role === "admin" && (
                <Link href="/admin" role="menuitem" className="t-body block rounded-xl px-2.5 py-2 hover:bg-surface-2">
                  Статистика
                </Link>
              )}
              <form action={signOutAction}>
                <button type="submit" role="menuitem" className="t-body w-full rounded-xl px-2.5 py-2 text-left text-red hover:bg-red-soft">
                  Выйти
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
