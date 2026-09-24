"use client";

import { useEffect, useState } from "react";
import type { Citation } from "@/lib/citations";
import { AgentStepList, type Trace } from "./AgentSteps";

// While the agent works: its steps arrive live over /ask/stream, so show
// exactly what it is doing and how long it has been at it.
type Props = {
  startedAt: number;
  withDocument: boolean;
  trace: Trace;
  onCite: (c: Citation) => void;
  onCancel: () => void;
};

export function Thinking({ startedAt, withDocument, trace, onCite, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div className="card p-5 sm:p-6" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <p className="t-body font-semibold">
          {withDocument ? "Сверяю договор с Трудовым кодексом" : "Агент работает"}
        </p>
        <span className="t-caption shrink-0 tabular-nums text-text-3">{seconds} с</span>
      </div>
      <div className="mt-4">
        {trace.path.length > 0 ? (
          <AgentStepList trace={trace} live onCite={onCite} />
        ) : (
          <p className="t-caption shimmer">Подключаюсь к агенту…</p>
        )}
      </div>
      <p className="t-caption mt-4 text-text-3">
        {withDocument ? "Проверка договора обычно занимает до минуты." : "Обычно 10–30 секунд."}
      </p>
      <button onClick={onCancel} className="pressable t-caption mt-2 font-semibold text-accent-ink">
        Отменить
      </button>
    </div>
  );
}
