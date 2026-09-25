"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Bars3Icon, PlusIcon } from "@heroicons/react/20/solid";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AgentEvent, type AskResponse, type ChatSummary, type Clause, type DocumentResponse, type Me, type ReviewRow } from "@/lib/api";
import type { Citation } from "@/lib/citations";
import { chatTitle, openChatId, rememberOpenChat, type SavedChat } from "@/lib/history";
import { spring, springSnappy } from "@/lib/motion";
import type { Trace } from "./AgentSteps";
import { AnswerCard } from "./AnswerCard";
import { CitationView } from "./CitationView";
import { ACCEPT, Composer } from "./Composer";
import { ContractReview, ReviewDetail, type ReviewState } from "./ContractReview";
import { DocumentCard } from "./DocumentCard";
import { Logo, Wordmark } from "./Logo";
import { SearchCompare } from "./SearchCompare";
import { Sheet } from "./Sheet";
import { Sidebar, type SignedInUser } from "./Sidebar";
import { Thinking } from "./Thinking";
import { WordRotate } from "./WordRotate";

type Item =
  | { id: string; kind: "question"; text: string; withDocument: string | null }
  | { id: string; kind: "document"; doc: DocumentResponse }
  | { id: string; kind: "review"; documentId: string; filename: string; review: ReviewState }
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
        : x.kind === "review" && x.review.status === "running"
          ? { ...x, review: { ...x.review, status: "error", error: "Проверка прервалась: страница была обновлена." } }
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

export function QorgauApp({ user }: { user: SignedInUser | null }) {
  const [tab, setTab] = useState<Tab>("assistant");
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; uploading: boolean; id?: string } | null>(null);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [reviewRow, setReviewRow] = useState<ReviewRow | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [dragging, setDragging] = useState(false);
  const sessionId = useRef<string>("");
  const abort = useRef<AbortController | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [activeId, setActiveId] = useState("");
  const [drawer, setDrawer] = useState(false); // history drawer on phones
  const [sidebarHidden, setSidebarHidden] = useState(false); // laptops
  // The items as last loaded or saved: no need to save them again.
  const saved = useRef<Item[] | null>(null);
  const pendingSave = useRef<(() => void) | null>(null);
  const [away, setAway] = useState(false); // scrolled up from the latest message
  const reduced = useReducedMotion();

  const busy = items.some((i) => i.kind === "pending" || (i.kind === "review" && i.review.status === "running"));

  const showChat = useCallback((id: string, chat: SavedChat<Item> | null) => {
    const restoredItems = chat?.items?.length ? restoreItems(chat.items) : [];
    sessionId.current = id;
    saved.current = restoredItems;
    setActiveId(id);
    setItems(restoredItems);
    setClauses(chat?.clauses ?? []);
    rememberOpenChat(restoredItems.length ? id : null);
  }, []);

  useEffect(() => {
    // The chat list comes from the server; a reload reopens the chat that was
    // open in this tab. The server-rendered page is always an empty new chat.
    sessionId.current = `web-${uid()}`;
    api
      .chats()
      .then((list) => {
        setChats(list);
        const open = openChatId();
        if (open && list.some((c) => c.id === open)) {
          return api.chat<SavedChat<Item>>(open).then((r) => showChat(open, r.chat));
        }
      })
      .catch(() => setChats((c) => c ?? []));
    api.me().then(setMe).catch(() => setMe(null));
    api
      .health()
      .then((h) => setOnline(h.qdrant_connected && h.collection_exists))
      .catch(() => setOnline(false));
  }, [showChat]);

  // To the very end of the page: main's bottom padding is what lifts the last
  // message above the fixed composer bar, so scrolling to the thread's last
  // element would leave it under the bar.
  const scrollToEnd = useCallback(
    () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced ? "auto" : "smooth" }),
    [reduced],
  );

  // A contract review is long and its verdict is at the top: keep its header
  // in view instead of the end of the clause list.
  useEffect(() => {
    const last = items[items.length - 1];
    if (!last) return;
    if (last.kind === "review") {
      document.getElementById(`item-${last.id}`)?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    } else {
      scrollToEnd();
    }
  }, [items, scrollToEnd, reduced]);

  // Save the open chat once live progress settles (it changes items many
  // times a second). Switching chats saves at once instead of waiting.
  const flushSave = useCallback(() => {
    const save = pendingSave.current;
    pendingSave.current = null;
    save?.();
  }, []);

  useEffect(() => {
    if (!items.length || items === saved.current) return;
    const id = sessionId.current;
    const title = chatTitle(items);
    const chat = { sessionId: id, items, clauses };
    pendingSave.current = () => {
      saved.current = items;
      rememberOpenChat(id);
      api
        .saveChat(id, title, chat)
        .then(() =>
          setChats((cs) => [{ id, title, updated_at: new Date().toISOString() }, ...(cs ?? []).filter((c) => c.id !== id)]),
        )
        .catch(() => {});
    };
    const t = setTimeout(flushSave, 800);
    return () => clearTimeout(t);
  }, [items, clauses, flushSave]);

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
    flushSave();
    abort.current?.abort();
    showChat(`web-${uid()}`, null);
    setAttachment(null);
    setDraft("");
    setCitation(null);
    setTab("assistant");
    window.scrollTo({ top: 0 });
  }

  async function openChat(id: string) {
    setTab("assistant");
    if (id === sessionId.current) return;
    flushSave();
    abort.current?.abort();
    setAttachment(null);
    setCitation(null);
    try {
      const r = await api.chat<SavedChat<Item>>(id);
      showChat(id, r.chat);
      window.scrollTo({ top: 0 });
    } catch {
      setChats((cs) => (cs ?? []).filter((c) => c.id !== id)); // gone on the server
    }
  }

  async function deleteChat(id: string) {
    setChats((cs) => (cs ?? []).filter((c) => c.id !== id));
    if (id === sessionId.current) {
      pendingSave.current = null; // do not bring it back
      abort.current?.abort();
      showChat(`web-${uid()}`, null);
    }
    await api.deleteChat(id).catch(() => {});
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

  // Drag-and-drop of a contract anywhere on the page. `dragleave` is no use
  // for hiding the overlay: it fires for every child the cursor crosses, and
  // Safari sends none when a file is dragged out of the window or the drag is
  // cancelled with Esc. While a file hovers, the browser repeats `dragover`
  // every ~50 ms, so the overlay stays up only while that heartbeat lasts.
  const attachRef = useRef(attach);
  attachRef.current = attach;
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    let lastOver = 0;
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // allows the drop
      lastOver = performance.now();
      setDragging(true);
    };
    const reset = () => setDragging(false);
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // the browser would otherwise open the file
      reset();
      const f = e.dataTransfer?.files?.[0];
      if (f && ACCEPT.split(",").includes(f.type)) attachRef.current(f);
    };
    const watchdog = setInterval(() => lastOver && performance.now() - lastOver > 250 && ((lastOver = 0), reset()), 150);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      clearInterval(watchdog);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
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
    if (!items.length || !chats?.some((c) => c.id === sessionId.current)) {
      const id = sessionId.current;
      const title = chatTitle([...items, { kind: "question", text: question }]);
      setActiveId(id);
      setChats((cs) => [{ id, title, updated_at: new Date().toISOString() }, ...(cs ?? []).filter((c) => c.id !== id)]);
    }
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

  // Colour-coded review of an uploaded contract: a verdict per clause, streamed.
  async function reviewDocument(doc: DocumentResponse, retryId?: string) {
    if (busy) return;
    const id = retryId ?? uid();
    const start: ReviewState = { status: "running", stage: "search", clauses: doc.clauses, rows: [] };
    const patch = (fn: (r: ReviewState) => ReviewState) =>
      setItems((xs) => xs.map((x) => (x.id === id && x.kind === "review" ? { ...x, review: fn(x.review) } : x)));
    if (retryId) patch(() => start);
    else setItems((xs) => [...xs, { id, kind: "review", documentId: doc.document_id, filename: doc.filename, review: start }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const review = await api.reviewStream(
        doc.document_id,
        (e) => patch((r) => (e.type === "stage" ? { ...r, stage: e.stage } : { ...r, rows: [...r.rows, e] })),
        controller.signal,
      );
      patch((r) => ({ ...r, status: "done", rows: review.clauses, review }));
      setMe((m) => (m ? { ...m, questions_today: m.questions_today + 1 } : m));
    } catch (e) {
      const error = controller.signal.aborted ? "Проверка отменена." : (e as Error).message;
      patch((r) => ({ ...r, status: "error", error }));
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


  return (
    <MotionConfig reducedMotion="user">
      <Sidebar
        chats={chats}
        activeId={items.length ? activeId : ""}
        onSelect={openChat}
        onNew={newChat}
        onDelete={deleteChat}
        user={user}
        me={me}
        open={drawer}
        onClose={() => setDrawer(false)}
        hidden={sidebarHidden}
        onHide={() => setSidebarHidden(true)}
      />
      <div className={`min-h-dvh transition-[padding] duration-300 ${sidebarHidden ? "" : "lg:pl-72"}`}>
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

        <Header
          tab={tab}
          onTab={setTab}
          online={online}
          onNewChat={items.length > 0 ? newChat : undefined}
          onMenu={() => setDrawer(true)}
          sidebarHidden={sidebarHidden}
          onShowSidebar={() => setSidebarHidden(false)}
        />

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
                        id={`item-${item.id}`}
                        className="scroll-mt-20"
                        layout="position"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={spring}
                      >
                        <ThreadItem
                          item={item}
                          question={questionBefore(items, i)}
                          reviewed={item.kind === "document" && items.some((x) => x.kind === "review" && x.documentId === item.doc.document_id)}
                          busy={busy}
                          onReview={reviewDocument}
                          onOpenReview={setReviewRow}
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
          <div
            className={`pointer-events-none fixed inset-x-0 bottom-0 z-30 transition-[left] duration-300 ${sidebarHidden ? "" : "lg:left-72"}`}
          >
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
              className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-[2rem] border-2 border-dashed border-accent-ink bg-bg/90 backdrop-blur-sm"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={springSnappy}
            >
              <div className="text-center">
                <p className="t-title text-accent-ink">Отпустите, чтобы загрузить договор</p>
                <p className="t-caption mt-1 text-text-2">PDF, Word, JPG или PNG до 10 МБ</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Sheet open={!!reviewRow} onClose={() => setReviewRow(null)} label="Проверка пункта договора" side>
          {reviewRow && <ReviewDetail key={reviewRow.clause_number} row={reviewRow} />}
        </Sheet>

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
  reviewed: boolean;
  busy: boolean;
  onReview: (doc: DocumentResponse, retryId?: string) => void;
  onOpenReview: (row: ReviewRow) => void;
  onCite: (c: Citation) => void;
  onCancel: () => void;
  onRate: (itemId: string, traceId: string, helpful: boolean, comment?: string) => void;
};

function ThreadItem({ item, question, reviewed, busy, onReview, onOpenReview, onCite, onCancel, onRate }: ThreadItemProps) {
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
      return <DocumentCard doc={item.doc} onReview={reviewed ? undefined : () => onReview(item.doc)} disabled={busy} />;
    case "review":
      return (
        <ContractReview
          state={item.review}
          filename={item.filename}
          onOpen={onOpenReview}
          onRetry={
            item.review.status === "error"
              ? () => onReview({ document_id: item.documentId, filename: item.filename, clauses: item.review.clauses } as DocumentResponse, item.id)
              : undefined
          }
        />
      );
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
  { title: "Спросите своими словами", text: "Или загрузите трудовой договор — PDF, Word или фото" },
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
  onMenu: () => void;
  sidebarHidden: boolean;
  onShowSidebar: () => void;
};

// At the top of the page the header is flat and lines up with the content;
// once the thread scrolls it shrinks into a floating glass capsule (the
// "resizable navbar" pattern), and the active tab carries a gold lamp that
// glides between tabs (the "tubelight" pattern). The brand, new chat and the
// account live in the sidebar; on phones (or with the sidebar hidden) the
// header brings back the menu button, the emblem and "new chat".
function Header({ tab, onTab, online, onNewChat, onMenu, sidebarHidden, onShowSidebar }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Shown on phones always, on laptops only while the sidebar is hidden.
  const compact = sidebarHidden ? "" : "lg:hidden";
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: "assistant",
      label: "Помощник",
      icon: <path d="M2.5 3.5a1 1 0 011-1h9a1 1 0 011 1v6.5a1 1 0 01-1 1H7l-3 2.5v-2.5h-.5a1 1 0 01-1-1z" />,
    },
    { id: "search", label: "Поиск A/B", icon: <path d="M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11 11l3.5 3.5" /> },
  ];
  const status = online === null ? "Подключение…" : online ? "База подключена" : "Бэкенд недоступен";
  return (
    <header className="pointer-events-none sticky top-0 z-30 px-2 pt-2 sm:px-4">
      <motion.div
        initial={false}
        animate={
          scrolled
            ? { maxWidth: 680, height: 52, paddingLeft: 8, paddingRight: 10 }
            : { maxWidth: 768, height: 52, paddingLeft: 12, paddingRight: 16 }
        }
        transition={spring}
        className={`pointer-events-auto mx-auto flex items-center gap-2 rounded-full border transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ${
          scrolled ? "material-thick border-hairline" : "border-transparent"
        }`}
      >
        {/* Left and right clusters share flex-1 so the tabs stay centred. */}
        <div className="flex flex-1 items-center gap-1.5">
          <button
            onClick={sidebarHidden ? () => (window.matchMedia("(min-width: 64rem)").matches ? onShowSidebar() : onMenu()) : onMenu}
            className={`pressable grid size-9 place-items-center rounded-full text-text-2 hover:bg-surface-2 hover:text-text ${compact}`}
            aria-label="История чатов"
            title="История чатов"
          >
            <Bars3Icon className="size-5" />
          </button>
          <span className={`items-center gap-2 ${sidebarHidden ? "flex" : "flex lg:hidden"}`}>
            <Logo size={28} />
            <Wordmark className="hidden min-[480px]:inline" />
          </span>
        </div>
        <nav className="flex gap-0.5 rounded-full border border-hairline bg-surface-2/70 p-1" aria-label="Разделы">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                aria-current={active ? "page" : undefined}
                aria-label={t.label}
                className={`pressable t-caption relative rounded-full px-3 py-1.5 font-semibold whitespace-nowrap transition-colors sm:px-4 ${
                  active ? "text-text" : "text-text-2 hover:text-text"
                }`}
              >
                {active && (
                  <motion.span layoutId="tubelight" className="absolute inset-0 rounded-full bg-surface shadow-[var(--shadow-sm)]" transition={spring}>
                    <span className="absolute -top-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-t-full bg-gold" aria-hidden>
                      <span className="absolute -top-2 -left-2 h-6 w-12 rounded-full bg-gold/25 blur-md" />
                      <span className="absolute -top-1 h-6 w-8 rounded-full bg-gold/25 blur-md" />
                      <span className="absolute top-0 left-2 size-4 rounded-full bg-gold/25 blur-sm" />
                    </span>
                  </motion.span>
                )}
                <span className="relative flex items-center gap-1.5">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="sm:hidden"
                    aria-hidden
                  >
                    {t.icon}
                  </svg>
                  <span className="hidden sm:inline">{t.label}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="flex flex-1 items-center justify-end gap-2">
          <AnimatePresence initial={false}>
            {onNewChat && (
              <motion.button
                onClick={onNewChat}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={springSnappy}
                className={`pressable t-caption inline-flex items-center gap-1.5 rounded-full bg-surface-2 p-2 font-medium text-text hover:bg-accent-soft hover:text-accent-ink ${compact}`}
                aria-label="Новый чат"
                title="Начать новый чат"
              >
                <PlusIcon className="size-4" />
              </motion.button>
            )}
          </AnimatePresence>
          <span className="grid size-5 shrink-0 place-items-center" title={status} role="status" aria-label={status}>
            <span className="relative flex size-2">
              {online && <span className="absolute inset-0 animate-ping rounded-full bg-green opacity-60 motion-reduce:animate-none" />}
              <span className={`relative size-2 rounded-full ${online === null ? "bg-text-3" : online ? "bg-green" : "bg-red"}`} />
            </span>
          </span>
        </div>
      </motion.div>
    </header>
  );
}
