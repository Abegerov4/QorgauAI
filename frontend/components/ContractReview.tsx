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
import { DocumentMagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Clause, ContractReview as Review, ReviewRow, ReviewVerdict } from "@/lib/api";
import { citationLabel, parseCitation } from "@/lib/citations";
import { plural } from "@/lib/labels";
import { spring, springSnappy } from "@/lib/motion";
import { CitationView } from "./CitationView";

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
  { label: string; short: string; icon: typeof XCircleIcon; ink: string; bar: string; tint: string; chip: string }
> = {
  violation: { label: "Нарушение", short: "нарушение", icon: XCircleIcon, ink: "text-red", bar: "bg-red", tint: "bg-red-soft", chip: "bg-red-soft text-red" },
  disputed: { label: "Спорно", short: "спорно", icon: ExclamationTriangleIcon, ink: "text-gold-ink", bar: "bg-gold", tint: "bg-gold-soft", chip: "bg-gold-soft text-gold-ink" },
  ok: { label: "Нарушений не найдено", short: "без нарушений", icon: CheckCircleIcon, ink: "text-green", bar: "bg-green", tint: "", chip: "bg-green-soft text-green" },
  unchecked: { label: "Не проверен", short: "не проверено", icon: MinusCircleIcon, ink: "text-text-3", bar: "bg-text-3", tint: "", chip: "bg-surface-2 text-text-2" },
};

const ORDER: ReviewVerdict[] = ["violation", "disputed", "ok", "unchecked"];

const STAGE: Record<NonNullable<ReviewState["stage"]>, (n: number) => string> = {
  search: (n) => `Ищу нормы для ${n} ${plural(n, "пункта", "пунктов", "пунктов")}`,
  review: () => "Сравниваю каждый пункт с нормами",
  verify: () => "Второй агент перепроверяет нарушения",
};

type Props = { state: ReviewState; filename: string; onOpen: (row: ReviewRow) => void; onRetry?: () => void };

export function ContractReview({ state, filename, onOpen, onRetry }: Props) {
  const [problemsOnly, setProblemsOnly] = useState(false);
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
            <p className="t-eyebrow text-text-3">Проверка договора</p>
            <h3 className="t-title mt-0.5 truncate">{filename}</h3>
            <p className="t-caption mt-1 text-text-2" aria-live="polite">
              {running ? (
                <span className="shimmer">{STAGE[state.stage ?? "search"](state.clauses.length)}…</span>
              ) : state.status === "error" ? (
                <span className="text-red">{state.error ?? "Проверка не удалась."}</span>
              ) : (
                <Summary counts={counts} />
              )}
            </p>
          </div>
        </div>

        <ShareBar counts={counts} total={listed.length} running={running} />

        {state.status === "done" && (
          <div className="mt-3 flex items-center gap-1.5" role="group" aria-label="Какие пункты показать">
            <FilterChip active={!problemsOnly} onClick={() => setProblemsOnly(false)}>
              Все {listed.length}
            </FilterChip>
            <FilterChip active={problemsOnly} onClick={() => setProblemsOnly(true)} disabled={problems === 0}>
              Только проблемы {problems}
            </FilterChip>
          </div>
        )}
        {state.status === "error" && onRetry && (
          <button onClick={onRetry} className="pressable t-caption mt-3 rounded-full bg-accent px-3.5 py-1.5 font-semibold text-white">
            Проверить ещё раз
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
        {problemsOnly && shown.length === 0 && <p className="t-body p-5 text-text-2">Проблемных пунктов нет.</p>}
      </div>

      {state.review && (
        <footer className="border-t border-hairline px-5 py-3.5 sm:px-6">
          {state.review.truncated && (
            <p className="t-caption mb-1.5 text-gold-ink">Проверены первые {listed.length} пунктов: договор длиннее.</p>
          )}
          <p className="t-caption text-text-3">{state.review.disclaimer}</p>
        </footer>
      )}
    </article>
  );
}

function countRows(rows: ReviewRow[]): Record<ReviewVerdict, number> {
  const counts = { violation: 0, disputed: 0, ok: 0, unchecked: 0 };
  for (const r of rows) counts[r.verdict] += 1;
  return counts;
}

function Summary({ counts }: { counts: Record<ReviewVerdict, number> }) {
  const parts = [
    counts.violation && `${counts.violation} ${plural(counts.violation, "нарушение", "нарушения", "нарушений")}`,
    counts.disputed && `${counts.disputed} ${plural(counts.disputed, "спорный пункт", "спорных пункта", "спорных пунктов")}`,
    counts.ok && `${counts.ok} без нарушений`,
    counts.unchecked && `${counts.unchecked} не проверено`,
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
  const v = row ? VERDICT[row.verdict] : null;
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
            <span className="sr-only">{v.label}</span>
            {row && row.verdict !== "ok" && <span className="t-caption hidden font-semibold sm:inline">{v.label}</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
  const base = "relative flex w-full items-start gap-2 py-3 pr-4 pl-5 text-left sm:pr-6 sm:pl-6";
  return (
    <li className={row && v?.tint ? v.tint : ""}>
      {row ? (
        <button onClick={() => onOpen(row)} className={`${base} transition-colors hover:bg-surface-2/60`} aria-label={`Пункт ${clause.clause_number}: ${v?.label}. Подробнее`}>
          {content}
        </button>
      ) : (
        <div className={base}>{content}</div>
      )}
    </li>
  );
}

/** What the side panel shows for one clause: the verdict, the norm, and a lawful rewording. */
export function ReviewDetail({ row }: { row: ReviewRow }) {
  const v = VERDICT[row.verdict];
  const [article, setArticle] = useState<string | null>(null);
  const Icon = v.icon;

  if (article) {
    return (
      <div>
        <button onClick={() => setArticle(null)} className="pressable t-caption mb-3 inline-flex items-center gap-1 font-semibold text-accent-ink">
          <ArrowLeftIcon className="size-4" aria-hidden />К пункту {row.clause_number}
        </button>
        <CitationView citation={parseCitation(article)} clauses={[]} />
      </div>
    );
  }

  return (
    <div className="pb-2">
      <span className={`t-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${v.chip}`}>
        <Icon className="size-4" aria-hidden />
        {v.label}
      </span>
      <h2 className="t-title mt-2 pr-10">Пункт {row.clause_number}</h2>
      <blockquote className="t-body mt-3 rounded-2xl bg-surface-2 px-4 py-3 text-text">«{row.text}»</blockquote>

      <h3 className="t-eyebrow mt-5 text-text-3">Почему</h3>
      <p className="t-body mt-1.5">{row.explanation}</p>
      {row.verified === false && (
        <p className="t-caption mt-2 rounded-xl bg-gold-soft px-3 py-2 text-text">
          Второй агент не подтвердил этот вывод по найденным нормам — отнеситесь к нему осторожно.
        </p>
      )}

      {row.norms.length > 0 && (
        <>
          <h3 className="t-eyebrow mt-5 text-text-3">{row.norms.length > 1 ? "Нормы" : "Норма"}</h3>
          <ul className="mt-1.5 space-y-2.5">
            {row.norms.map((n) => {
              const c = parseCitation(n.citation);
              return (
                <li key={n.citation} className="border-l-2 border-gold pl-3">
                  <p className="t-caption font-semibold text-gold-ink">{citationLabel(c)}</p>
                  <p className="text-[0.9375rem] leading-snug mt-0.5 text-text">{n.text}</p>
                  {c.kind === "law" && (
                    <button onClick={() => setArticle(n.citation)} className="pressable t-caption mt-1 font-semibold text-accent-ink">
                      Вся статья →
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
          <h3 className="t-eyebrow mt-5 text-text-3">Как исправить</h3>
          <div className="mt-1.5 rounded-2xl border border-green/30 bg-green-soft px-4 py-3">
            <p className="t-body text-text">{row.fix}</p>
            <CopyFix text={row.fix} />
          </div>
        </>
      )}
    </div>
  );
}

function CopyFix({ text }: { text: string }) {
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
      {done ? "Скопировано" : "Скопировать формулировку"}
    </button>
  );
}
