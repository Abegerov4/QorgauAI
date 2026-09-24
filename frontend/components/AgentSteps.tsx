"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import type { AskResponse, ToolCall } from "@/lib/api";
import { citationLabel, parseCitation, type Citation } from "@/lib/citations";
import { plural } from "@/lib/labels";
import { CitationChip } from "./CitationChip";
import { spring, springSnappy } from "@/lib/motion";

// What the agent did, as a vertical chain of steps (the "chain of thought"
// pattern): graph nodes in order, with the MCP tool calls and the norms they
// returned nested under each research pass. Built from the same data live
// (/ask/stream events) and after the answer (AskResponse).

export type Trace = {
  path: string[];
  tools: ToolCall[];
  /** Verifier result per verify pass, in order; undefined while it runs. */
  verified: ({ checked: number; supported: number } | undefined)[];
  removed?: number;
};

export function traceFromAnswer(a: AskResponse): Trace {
  // The response carries the verifier result of the last pass only.
  const passes = a.path.filter((n) => n === "verify").length;
  const last = a.checked_claims ? { checked: a.checked_claims, supported: a.supported_claims } : undefined;
  return {
    path: a.path,
    tools: a.tool_calls ?? [],
    verified: Array.from({ length: passes }, (_, i) => (i === passes - 1 ? last : undefined)),
    removed: a.removed_claims.length,
  };
}

type Step = { key: string; tone: "done" | "active" | "warn"; title: string; detail?: string; tools?: ToolCall[] };

const MAX_CHIPS = 4;

// The step that is still running reads in the present tense.
const RUNNING: Record<string, string> = {
  guard_input: "Проверяю запрос",
  research: "Ищу нормы в законе",
  generate: "Пишу ответ со ссылками на нормы",
  verify: "Второй агент проверяет утверждения",
  finalize: "Собираю ответ",
};

function buildSteps(trace: Trace, live: boolean): Step[] {
  let research = 0;
  let verify = 0;
  const steps = trace.path.map((node, i): Step => {
    const key = `${node}-${i}`;
    switch (node) {
      case "guard_input":
        return { key, tone: "done", title: "Проверил запрос", detail: "ИИН, телефоны и счета скрыты до отправки в модель" };
      case "research": {
        const tools = trace.tools.filter((t) => t.attempt === research);
        research += 1;
        const searches = tools.filter((t) => t.name === "search_legal_corpus").length;
        const articles = tools.filter((t) => t.name === "get_article").length;
        const parts = [
          searches && `${searches} ${plural(searches, "поиск", "поиска", "поисков")}`,
          articles && `${articles} ${plural(articles, "статья", "статьи", "статей")}`,
        ].filter(Boolean);
        return {
          key,
          tone: "done",
          title: research > 1 ? "Искал нормы ещё раз" : "Искал нормы в законе",
          detail: parts.join(" · ") || undefined,
          tools,
        };
      }
      case "generate":
        return { key, tone: "done", title: "Написал ответ со ссылками на нормы" };
      case "verify": {
        const v = trace.verified[verify];
        verify += 1;
        return {
          key,
          tone: v && v.supported < v.checked ? "warn" : "done",
          title: "Второй агент проверил утверждения",
          detail: v ? `Подтверждено ${v.supported} из ${v.checked}` : undefined,
        };
      }
      case "rewrite_query":
        return { key, tone: "warn", title: "Не всё подтвердилось — уточняю поиск" };
      case "finalize":
        return {
          key,
          tone: "done",
          title: "Собрал ответ",
          detail: trace.removed ? `Убрал без подтверждения: ${trace.removed}` : undefined,
        };
      default:
        return { key, tone: "done", title: node };
    }
  });
  if (live && steps.length) {
    const last = steps[steps.length - 1];
    const node = trace.path[trace.path.length - 1];
    last.tone = "active";
    last.title = RUNNING[node] ?? last.title;
  }
  return steps;
}

type ListProps = { trace: Trace; live?: boolean; onCite?: (c: Citation) => void };

export function AgentStepList({ trace, live = false, onCite }: ListProps) {
  const steps = buildSteps(trace, live);
  return (
    <ol className="space-y-0" aria-label="Шаги агента">
      <AnimatePresence initial={false}>
        {steps.map((s, i) => (
          <motion.li
            key={s.key}
            className="relative flex gap-3 pb-4 last:pb-0"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSnappy}
          >
            {i < steps.length - 1 && <span className="absolute top-6 bottom-1 left-[9px] w-px bg-hairline" aria-hidden />}
            <StepIcon tone={s.tone} />
            <div className="min-w-0 flex-1">
              <p className={`t-body leading-snug font-medium ${s.tone === "active" ? "shimmer" : ""}`}>{s.title}</p>
              {s.detail && <p className="t-caption mt-0.5 text-text-2">{s.detail}</p>}
              {s.tools && s.tools.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {s.tools.map((t, j) => (
                    <ToolRow key={j} tool={t} onCite={onCite} />
                  ))}
                </ul>
              )}
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

function ToolRow({ tool, onCite }: { tool: ToolCall; onCite?: (c: Citation) => void }) {
  let icon: React.ReactNode;
  let text: React.ReactNode;
  if (tool.name === "search_legal_corpus") {
    icon = <path d="M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11 11l3.5 3.5" />;
    text = <>Поиск «{String(tool.args.query ?? "")}»</>;
  } else if (tool.name === "get_article") {
    icon = <path d="M2 3.5c2-1 4-1 6 .5 2-1.5 4-1.5 6-.5v9c-2-1-4-1-6 .5-2-1.5-4-1.5-6-.5zM8 4v9" />;
    text = "Прочитал статью целиком";
  } else {
    icon = <path d="M3.5 1.5h9a1 1 0 011 1v11a1 1 0 01-1 1h-9a1 1 0 01-1-1v-11a1 1 0 011-1zM5 4.5h6M5.5 8h.01M8 8h.01M10.5 8h.01M5.5 11h.01M8 11h.01M10.5 11h.01" />;
    text = <>Посчитал отпуск{tool.result ? `: ${tool.result}` : ""}</>;
  }
  const chips = tool.found.slice(0, MAX_CHIPS);
  const more = tool.found.length - chips.length;
  return (
    <li className="rounded-xl bg-surface-2 px-3 py-2">
      <p className="t-caption flex items-start gap-1.5 text-text-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-px shrink-0 text-accent-ink"
          aria-hidden
        >
          {icon}
        </svg>
        <span className="min-w-0">{text}</span>
      </p>
      {chips.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((raw) => {
            const cls = "t-caption rounded-full bg-surface px-2 py-0.5 font-medium text-accent-ink";
            return onCite ? (
              <CitationChip key={raw} raw={raw} onCite={onCite} className={`pressable ${cls} hover:bg-accent-soft`} />
            ) : (
              <span key={raw} title={raw} className={cls}>
                {citationLabel(parseCitation(raw))}
              </span>
            );
          })}
          {more > 0 && <span className="t-caption px-1 py-0.5 text-text-3">+{more}</span>}
        </div>
      ) : (
        tool.name === "search_legal_corpus" && <p className="t-caption mt-1 text-text-3">Ничего не нашлось</p>
      )}
    </li>
  );
}

function StepIcon({ tone }: { tone: Step["tone"] }) {
  if (tone === "active") {
    return (
      <span className="relative mt-0.5 grid size-[19px] shrink-0 place-items-center" aria-label="Выполняется">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-accent-soft border-t-accent-ink motion-reduce:animate-none" />
      </span>
    );
  }
  const warn = tone === "warn";
  return (
    <span
      className={`mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full ${warn ? "bg-gold-soft text-gold-ink" : "bg-green-soft text-green"}`}
      aria-hidden
    >
      {warn ? (
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
          <path d="M5 2v3.5M5 7.8v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M1.8 5.2l2.2 2.2 4.2-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/** Collapsible "how the agent found this" block under an answer. */
export function AgentSteps({ trace, onCite }: { trace: Trace; onCite: (c: Citation) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const searches = trace.tools.filter((t) => t.name === "search_legal_corpus").length;
  const articles = trace.tools.filter((t) => t.name === "get_article").length;
  const summary = [
    searches && `${searches} ${plural(searches, "поиск", "поиска", "поисков")}`,
    articles && `${articles} ${plural(articles, "статья", "статьи", "статей")}`,
    trace.path.includes("rewrite_query") && "повторный поиск",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rounded-2xl border border-hairline">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="pressable flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left hover:bg-surface-2"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="3.5" cy="3.5" r="1.75" />
            <circle cx="12.5" cy="8" r="1.75" />
            <circle cx="3.5" cy="12.5" r="1.75" />
            <path d="M5.2 4.3l5.6 2.9M10.8 8.8l-5.6 2.9" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="t-body block leading-snug font-medium">Как агент искал ответ</span>
          {summary && <span className="t-caption block text-text-3">{summary}</span>}
        </span>
        <motion.svg width="12" height="12" viewBox="0 0 10 10" animate={{ rotate: open ? 90 : 0 }} transition={spring} className="text-text-3" aria-hidden>
          <path d="M3 1.5L6.5 5 3 8.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="px-3.5 pt-1 pb-4">
              <AgentStepList trace={trace} onCite={onCite} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
