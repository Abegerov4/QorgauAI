"use client";

import { useEffect, useState } from "react";
import type { Citation } from "@/lib/citations";
import { useT } from "@/lib/i18n";
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
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div className="card p-5 sm:p-6" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <p className="t-body font-semibold">
          {withDocument ? t.thinkingDoc : t.thinking}
        </p>
        <span className="t-caption shrink-0 tabular-nums text-text-3">{t.seconds(seconds)}</span>
      </div>
      <div className="mt-4">
        {trace.path.length > 0 ? (
          <AgentStepList trace={trace} live onCite={onCite} />
        ) : (
          <p className="t-caption shimmer">{t.connecting}</p>
        )}
      </div>
      <p className="t-caption mt-4 text-text-3">
        {withDocument ? t.thinkingDocHint : t.thinkingHint}
      </p>
      <button onClick={onCancel} className="pressable t-caption mt-2 font-semibold text-accent-ink">
        {t.cancel}
      </button>
    </div>
  );
}
