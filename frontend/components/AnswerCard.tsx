"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { AnswerStatus, AskResponse } from "@/lib/api";
import { answerAsText } from "@/lib/answerText";
import { parseCitation, type Citation } from "@/lib/citations";
import { plural } from "@/lib/labels";
import { spring } from "@/lib/motion";
import { AgentSteps, traceFromAnswer } from "./AgentSteps";
import { CitationChip } from "./CitationChip";
import { countWords, GenerateText } from "./GenerateText";

const STATUS: Record<AnswerStatus, { label: string; tone: string }> = {
  answered: { label: "Подтверждено нормами", tone: "bg-green-soft text-green" },
  partial: { label: "Подтверждено частично", tone: "bg-gold-soft text-gold-ink" },
  refused: { label: "Нет подтверждённого ответа", tone: "bg-surface-2 text-text-2" },
};

type Props = {
  answer: AskResponse;
  seconds: number;
  onCite: (c: Citation) => void;
  /** The question it answers, included when the answer is copied. */
  question?: string;
  /** Just arrived (not restored from history): words appear one by one. */
  fresh: boolean;
  feedback?: "up" | "down";
  /** 👍/👎, sent to Langfuse on this answer's trace. */
  onRate: (helpful: boolean, comment?: string) => void;
};

// The whole answer appears in about this long however many words it has.
const REVEAL_SECONDS = 2.5;
const MAX_WORD_STEP = 0.035;
const CLAIM_PAUSE = 0.12;

// Answers already revealed once: switching tabs remounts the card, and the
// words should not type themselves out a second time.
const revealed = new WeakSet<AskResponse>();

export function AnswerCard({ answer, seconds, onCite, question, fresh, feedback, onRate }: Props) {
  const status = STATUS[answer.status];
  const reduced = useReducedMotion();
  const [firstTime] = useState(() => fresh && !revealed.has(answer));
  const animate = firstTime && !reduced;
  useEffect(() => {
    revealed.add(answer);
  }, [answer]);

  // Claims appear one after another: each starts when the previous is written.
  const texts = answer.claims.length ? answer.claims.map((c) => c.text) : [answer.answer];
  const counts = texts.map(countWords);
  const step = Math.min(MAX_WORD_STEP, REVEAL_SECONDS / Math.max(1, counts.reduce((a, b) => a + b, 0)));
  const starts = counts.map((_, i) => counts.slice(0, i).reduce((a, n) => a + n * step + CLAIM_PAUSE, 0));
  const done = starts[starts.length - 1] + counts[counts.length - 1] * step;
  const after = (delay: number) =>
    animate ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay, duration: 0.3 } } : {};

  return (
    <article className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`t-caption rounded-full px-2.5 py-1 font-semibold ${status.tone}`}>{status.label}</span>
        <span className="t-caption text-text-3">{seconds.toFixed(0)} с</span>
        <CopyButton text={() => answerAsText(answer, question)} />
      </div>

      {answer.claims.length === 0 ? (
        <p className="t-body mt-4">
          <GenerateText text={answer.answer} start={0} step={step} animate={animate} />
        </p>
      ) : (
        <div className="mt-4 space-y-3.5">
          {answer.claims.map((c, i) => (
            <Claim
              key={i}
              text={c.text}
              sources={c.sources}
              onCite={onCite}
              lead={i === 0}
              reveal={animate ? { start: starts[i], step } : null}
            />
          ))}
        </div>
      )}

      <motion.div {...after(done)}>
        {answer.recommend_lawyer && (
          <div className="t-caption mt-5 flex gap-2.5 rounded-2xl bg-gold-soft p-3.5 text-text">
            <span aria-hidden className="text-gold-ink">●</span>
            <span>Ситуация спорная или с высокой ценой ошибки — стоит показать её практикующему юристу.</span>
          </div>
        )}

        {answer.missing_info.length > 0 && (
          <section className="mt-5">
            <h3 className="t-eyebrow text-text-3">Что осталось за рамками ответа</h3>
            <ul className="t-body mt-2 space-y-1 text-text-2">
              {answer.missing_info.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden>–</span>
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {answer.removed_claims.length > 0 && <RemovedClaims claims={answer.removed_claims} />}

        {answer.trace_id && <Feedback value={feedback} onRate={onRate} />}

        <div className="mt-5">
          <AgentSteps trace={traceFromAnswer(answer)} onCite={onCite} />
          <p className="t-caption mt-3 text-text-3">{answer.disclaimer}</p>
        </div>
      </motion.div>
    </article>
  );
}

type ClaimProps = {
  text: string;
  sources: string[];
  onCite: (c: Citation) => void;
  lead?: boolean;
  /** Word-by-word appearance; null shows the claim at once. */
  reveal: { start: number; step: number } | null;
};

function Claim({ text, sources, onCite, lead, reveal }: ClaimProps) {
  const chipsAt = reveal ? reveal.start + countWords(text) * reveal.step : 0;
  return (
    <div>
      <p className={lead ? "text-[1.1875rem] leading-[1.45] font-medium tracking-[-0.01em]" : "t-body"}>
        <GenerateText text={text} start={reveal?.start ?? 0} step={reveal?.step ?? 0} animate={!!reveal} />
      </p>
      <motion.div
        className="mt-2 flex flex-wrap gap-1.5"
        {...(reveal ? { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { ...spring, delay: chipsAt } } : {})}
      >
        {sources.map((raw) => (
          <CitationChip
            key={raw}
            raw={raw}
            onCite={onCite}
            className={`pressable t-caption rounded-full px-2.5 py-1 font-medium ${
              parseCitation(raw).kind === "doc" ? "bg-surface-2 text-text" : "bg-accent-soft text-accent-ink"
            }`}
          />
        ))}
      </motion.div>
    </div>
  );
}

function RemovedClaims({ claims }: { claims: string[] }) {
  const [open, setOpen] = useState(false);
  const n = claims.length;
  return (
    <section className="mt-5">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable t-caption flex items-center gap-1.5 font-medium text-text-2"
      >
        <motion.svg width="10" height="10" viewBox="0 0 10 10" animate={{ rotate: open ? 90 : 0 }} transition={spring} aria-hidden>
          <path d="M3 1.5L6.5 5 3 8.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </motion.svg>
        Проверяющий агент убрал {n} {plural(n, "утверждение", "утверждения", "утверждений")} без подтверждения в законе
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            {claims.map((c, i) => (
              <li key={i} className="t-caption mt-2 rounded-xl bg-red-soft px-3 py-2 text-text-2 line-through decoration-text-3/50">
                {c}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}

function CopyButton({ text }: { text: () => string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      setState("done");
    } catch {
      setState("failed"); // no clipboard permission (e.g. an insecure context)
    }
  }

  return (
    <button
      onClick={copy}
      className="pressable t-caption ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-text-2 hover:bg-surface-2 hover:text-text"
      title="Скопировать ответ со ссылками на статьи"
      aria-label={state === "done" ? "Скопировано" : "Копировать ответ"}
    >
      {state === "done" ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-green" aria-hidden>
          <path d="M3 8.5l3.2 3.2L13 4.8" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
          <rect x="5.5" y="5.5" width="8" height="9" rx="1.5" />
          <path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v8a1 1 0 001 1h2" />
        </svg>
      )}
      {/* On a phone only the icon fits next to the status. */}
      <span className="hidden sm:inline" aria-live="polite">
        {state === "done" ? "Скопировано" : state === "failed" ? "Не удалось" : "Копировать"}
      </span>
    </button>
  );
}

function Feedback({ value, onRate }: { value?: "up" | "down"; onRate: (helpful: boolean, comment?: string) => void }) {
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const thumb = (up: boolean) => {
    const active = value === (up ? "up" : "down");
    return (
      <button
        onClick={() => {
          setSent(false);
          onRate(up);
        }}
        aria-pressed={active}
        aria-label={up ? "Полезный ответ" : "Бесполезный ответ"}
        title={up ? "Полезный ответ" : "Бесполезный ответ"}
        className={`pressable grid size-8 place-items-center rounded-full ${
          active ? (up ? "bg-green-soft text-green" : "bg-red-soft text-red") : "text-text-2 hover:bg-surface-2 hover:text-text"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden className={up ? "" : "rotate-180"}>
          <path d="M5 7l2.6-4.8a1.3 1.3 0 012.4.8L9.4 6.5h3.3a1.5 1.5 0 011.5 1.8l-.9 4.5a1.5 1.5 0 01-1.5 1.2H5zM2 7h3v7H2z" />
        </svg>
      </button>
    );
  };

  return (
    <section className="mt-5">
      <div className="flex items-center gap-1">
        <span className="t-caption mr-1 text-text-2">{value ? "Спасибо за оценку" : "Ответ был полезен?"}</span>
        {thumb(true)}
        {thumb(false)}
      </div>
      <AnimatePresence initial={false}>
        {value === "down" && !sent && (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              onRate(false, comment.trim());
              setSent(true);
            }}
          >
            <div className="flex gap-2 pt-2">
              <label htmlFor="feedback-comment" className="sr-only">
                Что не так с ответом
              </label>
              <input
                id="feedback-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={1000}
                placeholder="Что не так? Например: не та статья"
                className="t-caption min-w-0 flex-1 rounded-full border border-hairline bg-surface px-3.5 py-2 outline-none focus-visible:border-accent-ink"
              />
              <button type="submit" disabled={!comment.trim()} aria-label="Отправить отзыв" className="pressable t-caption rounded-full bg-accent px-3.5 py-2 font-semibold text-white disabled:bg-surface-2 disabled:text-text-3">
                Отправить
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </section>
  );
}
