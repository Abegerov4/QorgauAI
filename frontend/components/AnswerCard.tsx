"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { AnswerStatus, AskResponse } from "@/lib/api";
import { parseCitation, type Citation } from "@/lib/citations";
import { plural } from "@/lib/labels";
import { spring } from "@/lib/motion";
import { AgentSteps, traceFromAnswer } from "./AgentSteps";
import { CitationChip } from "./CitationChip";

const STATUS: Record<AnswerStatus, { label: string; tone: string }> = {
  answered: { label: "Подтверждено нормами", tone: "bg-green-soft text-green" },
  partial: { label: "Подтверждено частично", tone: "bg-gold-soft text-gold-ink" },
  refused: { label: "Нет подтверждённого ответа", tone: "bg-surface-2 text-text-2" },
};

type Props = { answer: AskResponse; seconds: number; onCite: (c: Citation) => void };

export function AnswerCard({ answer, seconds, onCite }: Props) {
  const status = STATUS[answer.status];
  const [first, ...rest] = answer.claims;

  return (
    <article className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`t-caption rounded-full px-2.5 py-1 font-semibold ${status.tone}`}>{status.label}</span>
        <span className="t-caption text-text-3">{seconds.toFixed(0)} с</span>
      </div>

      {answer.claims.length === 0 ? (
        <p className="t-body mt-4">{answer.answer}</p>
      ) : (
        <div className="mt-4 space-y-3.5">
          <Claim text={first.text} sources={first.sources} onCite={onCite} lead />
          {rest.map((c, i) => (
            <Claim key={i} text={c.text} sources={c.sources} onCite={onCite} />
          ))}
        </div>
      )}

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

      <div className="mt-5">
        <AgentSteps trace={traceFromAnswer(answer)} onCite={onCite} />
        <p className="t-caption mt-3 text-text-3">{answer.disclaimer}</p>
      </div>
    </article>
  );
}

function Claim({ text, sources, onCite, lead }: { text: string; sources: string[]; onCite: (c: Citation) => void; lead?: boolean }) {
  return (
    <div>
      <p className={lead ? "text-[1.1875rem] leading-[1.45] font-medium tracking-[-0.01em]" : "t-body"}>{text}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
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
      </div>
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
