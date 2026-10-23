"use client";

import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  XCircleIcon,
} from "@heroicons/react/20/solid";
import {
  ArrowDownTrayIcon,
  ChatBubbleLeftRightIcon,
  DocumentArrowDownIcon,
  DocumentMagnifyingGlassIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, type Clause, type ContractReview as Review, type ReviewRow, type ReviewVerdict } from "@/lib/api";
import { citationLabel, parseCitation } from "@/lib/citations";
import { useT } from "@/lib/i18n";
import { spring, springSnappy } from "@/lib/motion";
import { employerLetter } from "@/lib/reviewText";
import { CitationView } from "./CitationView";
import { Sheet } from "./Sheet";

// The contract as a document with every clause coloured by its verdict:
// red — contradicts a norm (confirmed by the second agent), yellow — disputed
// or unconfirmed, green — no conflict found, grey — not checked. Colour is
// never the only signal: each clause also carries an icon and a label.

export type ReviewState = {
  status: "running" | "done" | "error";
  stage?: "search" | "review" | "verify";
  clauses: Clause[];
  rows: ReviewRow[];
  review?: Review;
  error?: string;
};

export const VERDICT: Record<
  ReviewVerdict,
  { icon: typeof XCircleIcon; ink: string; bar: string; tint: string; chip: string }
> = {
  violation: { icon: XCircleIcon, ink: "text-red", bar: "bg-red", tint: "bg-red-soft", chip: "bg-red-soft text-red" },
  disputed: { icon: ExclamationTriangleIcon, ink: "text-gold-ink", bar: "bg-gold", tint: "bg-gold-soft", chip: "bg-gold-soft text-gold-ink" },
  ok: { icon: CheckCircleIcon, ink: "text-green", bar: "bg-green", tint: "", chip: "bg-green-soft text-green" },
  unchecked: { icon: MinusCircleIcon, ink: "text-text-3", bar: "bg-text-3", tint: "", chip: "bg-surface-2 text-text-2" },
};

const ORDER: ReviewVerdict[] = ["violation", "disputed", "ok", "unchecked"];

type Props = { state: ReviewState; filename: string; onOpen: (row: ReviewRow) => void; onRetry?: () => void };

export function ContractReview({ state, filename, onOpen, onRetry }: Props) {
  const t = useT();
  const stage = { search: t.stageSearch(state.clauses.length), review: t.stageReview, verify: t.stageVerify };
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [pdf, setPdf] = useState<"idle" | "busy" | "failed">("idle");
  const [letter, setLetter] = useState(false);
  const running = state.status === "running";
  const byNumber = new Map(state.rows.map((r) => [r.clause_number, r]));
  const counts = state.review?.counts ?? countRows(state.rows);
  const problems = counts.violation + counts.disputed;
  // Once done, the list is what was reviewed (section headings are not).
  const listed = state.review ? state.review.clauses : state.clauses;
  const shown = listed.filter((c) => {
    const v = byNumber.get(c.clause_number)?.verdict;
    return !problemsOnly || v === "violation" || v === "disputed";
  });

  return (
    <article className="card overflow-hidden" aria-busy={running}>
      <header className="p-5 pb-4 sm:p-6 sm:pb-4">
        <div className="flex items-start gap-3.5">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden>
            <DocumentMagnifyingGlassIcon className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="t-eyebrow text-text-3">{t.contractReview}</p>
            <h3 className="t-title mt-0.5 truncate">{filename}</h3>
            <p className="t-caption mt-1 text-text-2" aria-live="polite">
              {running ? (
                <span className="shimmer">{stage[state.stage ?? "search"]}…</span>
              ) : state.status === "error" ? (
                <span className="text-red">{state.error ?? t.reviewFailed}</span>
              ) : (
                <Summary counts={counts} />
              )}
            </p>
          </div>
        </div>

        <ShareBar counts={counts} total={listed.length} running={running} />

        {state.status === "done" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1.5" role="group" aria-label={t.whichClauses}>
              <FilterChip active={!problemsOnly} onClick={() => setProblemsOnly(false)}>
                {t.all(listed.length)}
              </FilterChip>
              <FilterChip active={problemsOnly} onClick={() => setProblemsOnly(true)} disabled={problems === 0}>
                {t.problemsOnly(problems)}
              </FilterChip>
            </div>
            {state.review && (
              <div className="flex items-center gap-1.5 sm:ml-auto">
                <ActionButton
                  onClick={async () => {
                    setPdf("busy");
                    try {
                      downloadFile(await api.reviewPdf(state.review!), t.pdfFile(filename.replace(/\.[^.]+$/, "")));
                      setPdf("idle");
                    } catch {
                      setPdf("failed");
                    }
                  }}
                  disabled={pdf === "busy"}
                  icon={<DocumentArrowDownIcon className="size-4" aria-hidden />}
                >
                  {pdf === "busy" ? t.pdfBusy : pdf === "failed" ? t.pdfRetry : t.pdf}
                </ActionButton>
                {counts.violation + counts.disputed > 0 && (
                  <ActionButton onClick={() => setLetter(true)} icon={<EnvelopeIcon className="size-4" aria-hidden />}>
                    {t.letter}
                  </ActionButton>
                )}
              </div>
            )}
          </div>
        )}
        {state.status === "error" && onRetry && (
          <button onClick={onRetry} className="pressable t-caption mt-3 rounded-full bg-accent px-3.5 py-1.5 font-semibold text-white">
            {t.checkAgain}
          </button>
        )}
      </header>

      <div className="relative border-t border-hairline">
        {running && state.stage !== "search" && <Scanner />}
        <ol className="divide-y divide-hairline">
          {shown.map((c, i) => (
            <ClauseLine key={c.clause_number} clause={c} row={byNumber.get(c.clause_number)} index={i} onOpen={onOpen} />
          ))}
        </ol>
        {problemsOnly && shown.length === 0 && <p className="t-body p-5 text-text-2">{t.noProblems}</p>}
      </div>

      {state.review && (
        <footer className="border-t border-hairline px-5 py-3.5 sm:px-6">
          {state.review.truncated && (
            <p className="t-caption mb-1.5 text-gold-ink">{t.truncated(listed.length)}</p>
          )}
          <p className="t-caption text-text-3">{state.review.disclaimer}</p>
        </footer>
      )}

      <Sheet open={letter} onClose={() => setLetter(false)} label={t.letter} side>
        {letter && state.review && <LetterView review={state.review} />}
      </Sheet>
    </article>
  );
}

function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000); // Safari reads the blob after click() returns
}

function ActionButton({
  onClick,
  icon,
  disabled,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="pressable t-caption inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1 font-semibold text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-60"
    >
      {icon}
      {children}
    </button>
  );
}

// A draft the user edits (placeholders in [brackets]) and then copies or saves.
function LetterView({ review }: { review: Review }) {
  const t = useT();
  const [text, setText] = useState(() => employerLetter(review));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const download = () => downloadFile(new Blob([text], { type: "text/plain;charset=utf-8" }), t.letterFile);

  return (
    <div className="pb-2">
      <h2 className="t-title pr-10">{t.letter}</h2>
      <p className="t-caption mt-1 text-text-2">{t.letterIntro}</p>
      {t.letterLangNote && <p className="t-caption mt-1 text-text-3">{t.letterLangNote}</p>}
      <label htmlFor="letter" className="sr-only">
        {t.letterText}
      </label>
      <textarea
        id="letter"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={20}
        className="t-body mt-3 w-full resize-y rounded-2xl border border-hairline bg-surface p-3.5 text-[0.9375rem] leading-relaxed outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => {})}
          className="pressable t-caption inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 font-semibold text-white"
        >
          {copied ? <CheckIcon className="size-4" aria-hidden /> : <ClipboardDocumentIcon className="size-4" aria-hidden />}
          {copied ? t.copied : t.copy}
        </button>
        <button
          onClick={download}
          className="pressable t-caption inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 font-semibold text-text"
        >
          <ArrowDownTrayIcon className="size-4" aria-hidden />
          {t.downloadTxt}
        </button>
        <button
          onClick={() => setText(employerLetter(review))}
          className="pressable t-caption px-2 py-1.5 font-medium text-text-2 hover:text-text"
        >
          {t.resetText}
        </button>
      </div>
      <p className="t-caption mt-3 text-text-3">{t.letterDisclaimer}</p>
    </div>
  );
}

function countRows(rows: ReviewRow[]): Record<ReviewVerdict, number> {
  const counts = { violation: 0, disputed: 0, ok: 0, unchecked: 0 };
  for (const r of rows) counts[r.verdict] += 1;
  return counts;
}

function Summary({ counts }: { counts: Record<ReviewVerdict, number> }) {
  const t = useT();
  const parts = [
    counts.violation && t.countViolations(counts.violation),
    counts.disputed && t.countDisputed(counts.disputed),
    counts.ok && t.countOk(counts.ok),
    counts.unchecked && t.countUnchecked(counts.unchecked),
  ].filter(Boolean);
  return <>{parts.join(" · ")}</>;
}

// Red, yellow, green, grey shares of the contract; a moving sheen while it runs.
function ShareBar({ counts, total, running }: { counts: Record<ReviewVerdict, number>; total: number; running: boolean }) {
  if (running) {
    return (
      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <motion.span
          className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-gold/60 to-transparent"
          initial={{ x: "-100%" }}
          animate={{ x: "300%" }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
    );
  }
  if (!total) return null;
  return (
    <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
      {ORDER.map((v) =>
        counts[v] ? (
          <motion.span
            key={v}
            className={`h-full rounded-full ${VERDICT[v].bar}`}
            initial={{ flexGrow: 0 }}
            animate={{ flexGrow: counts[v] }}
            transition={spring}
            style={{ flexBasis: 0 }}
          />
        ) : null,
      )}
    </div>
  );
}

// A gold line sweeping down the contract while the verdicts are being written.
function Scanner() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 z-10 h-16 bg-gradient-to-b from-transparent via-gold/15 to-transparent"
      initial={{ top: "-4rem" }}
      animate={{ top: "100%" }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
      aria-hidden
    >
      <span className="absolute inset-x-0 top-1/2 h-px bg-gold/70 shadow-[0_0_12px_var(--gold)]" />
    </motion.div>
  );
}

function FilterChip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`pressable t-caption rounded-full px-3 py-1 font-semibold tabular-nums transition-colors disabled:opacity-40 ${
        active ? "bg-text text-bg" : "bg-surface-2 text-text-2 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function ClauseLine({ clause, row, index, onOpen }: { clause: Clause; row?: ReviewRow; index: number; onOpen: (r: ReviewRow) => void }) {
  const t = useT();
  const v = row ? VERDICT[row.verdict] : null;
  const label = row ? t.verdict[row.verdict].label : "";
  const Icon = v?.icon;
  const content = (
    <>
      <motion.span
        className={`absolute inset-y-0 left-0 w-1 ${v ? v.bar : "bg-transparent"}`}
        initial={false}
        animate={{ scaleY: v ? 1 : 0 }}
        transition={{ ...springSnappy, delay: Math.min(index, 20) * 0.05 }}
        style={{ originY: 0 }}
        aria-hidden
      />
      <span className="t-caption w-9 shrink-0 pt-0.5 font-semibold text-text-3 tabular-nums">{clause.clause_number}</span>
      <span className={`text-[0.9375rem] leading-snug min-w-0 flex-1 ${row ? "line-clamp-2 text-text" : "line-clamp-2 text-text-2"}`}>{clause.text}</span>
      <AnimatePresence>
        {v && Icon && (
          <motion.span
            className={`flex shrink-0 items-center gap-1 ${v.ink}`}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...springSnappy, delay: Math.min(index, 20) * 0.05 }}
          >
            <Icon className="size-5" aria-hidden />
            <span className="sr-only">{label}</span>
            {row && row.verdict !== "ok" && <span className="t-caption hidden font-semibold sm:inline">{label}</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
  const base = "relative flex w-full items-start gap-2 py-3 pr-4 pl-5 text-left sm:pr-6 sm:pl-6";
  return (
    <li className={row && v?.tint ? v.tint : ""}>
      {row ? (
        <button onClick={() => onOpen(row)} className={`${base} transition-colors hover:bg-surface-2/60`} aria-label={t.clauseMore(clause.clause_number, label)}>
          {content}
        </button>
      ) : (
        <div className={base}>{content}</div>
      )}
    </li>
  );
}

/** What the side panel shows for one clause: the verdict, the norm, and a lawful rewording. */
export function ReviewDetail({ row, onAsk }: { row: ReviewRow; onAsk?: (row: ReviewRow) => void }) {
  const t = useT();
  const v = VERDICT[row.verdict];
  const [article, setArticle] = useState<string | null>(null);
  const Icon = v.icon;

  if (article) {
    return (
      <div>
        <button onClick={() => setArticle(null)} className="pressable t-caption mb-3 inline-flex items-center gap-1 font-semibold text-accent-ink">
          <ArrowLeftIcon className="size-4" aria-hidden />{t.backToClause(row.clause_number)}
        </button>
        <CitationView citation={parseCitation(article)} clauses={[]} />
      </div>
    );
  }

  return (
    <div className="pb-2">
      <span className={`t-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${v.chip}`}>
        <Icon className="size-4" aria-hidden />
        {t.verdict[row.verdict].label}
      </span>
      <h2 className="t-title mt-2 pr-10">{t.clause(row.clause_number)}</h2>
      <blockquote className="t-body mt-3 rounded-2xl bg-surface-2 px-4 py-3 text-text">«{row.text}»</blockquote>

      <h3 className="t-eyebrow mt-5 text-text-3">{t.why}</h3>
      <p className="t-body mt-1.5">{row.explanation}</p>
      {row.verified === false && (
        <p className="t-caption mt-2 rounded-xl bg-gold-soft px-3 py-2 text-text">
          {t.notVerified}
        </p>
      )}

      {row.norms.length > 0 && (
        <>
          <h3 className="t-eyebrow mt-5 text-text-3">{row.norms.length > 1 ? t.norms : t.norm}</h3>
          <ul className="mt-1.5 space-y-2.5">
            {row.norms.map((n) => {
              const c = parseCitation(n.citation);
              return (
                <li key={n.citation} className="border-l-2 border-gold pl-3">
                  <p className="t-caption font-semibold text-gold-ink">{citationLabel(c, t)}</p>
                  <p className="text-[0.9375rem] leading-snug mt-0.5 text-text">{n.text}</p>
                  {c.kind === "law" && (
                    <button onClick={() => setArticle(n.citation)} className="pressable t-caption mt-1 font-semibold text-accent-ink">
                      {t.wholeArticle}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {row.fix && (
        <>
          <h3 className="t-eyebrow mt-5 text-text-3">{t.howToFix}</h3>
          <div className="mt-1.5 rounded-2xl border border-green/30 bg-green-soft px-4 py-3">
            <p className="t-body text-text">{row.fix}</p>
            <CopyFix text={row.fix} />
          </div>
        </>
      )}

      {onAsk && (
        <button
          onClick={() => onAsk(row)}
          className="pressable t-body mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-hairline bg-surface px-4 py-2.5 font-semibold text-text hover:bg-surface-2"
        >
          <ChatBubbleLeftRightIcon className="size-5 text-accent-ink" aria-hidden />
          {t.askAboutClause}
        </button>
      )}
    </div>
  );
}

function CopyFix({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true), () => {})}
      className="pressable t-caption mt-2 inline-flex items-center gap-1.5 font-semibold text-green"
    >
      {done ? <CheckIcon className="size-4" aria-hidden /> : <ClipboardDocumentIcon className="size-4" aria-hidden />}
      {done ? t.copied : t.copyWording}
    </button>
  );
}
