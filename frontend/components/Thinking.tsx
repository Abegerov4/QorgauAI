"use client";

import { useEffect, useState } from "react";

// The backend does not stream progress yet, so show what is honestly known:
// what the agent does and how long it has been working.
export function Thinking({ startedAt, withDocument, onCancel }: { startedAt: number; withDocument: boolean; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div className="card p-5 sm:p-6" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <p className="t-body shimmer font-medium">
          {withDocument ? "Сверяю пункты договора с Трудовым кодексом…" : "Ищу нормы и проверяю каждое утверждение…"}
        </p>
        <span className="t-caption shrink-0 tabular-nums text-text-3">{seconds} с</span>
      </div>
      <p className="t-caption mt-2 text-text-2">
        Агент ищет статьи в Конституции и Трудовом кодексе, пишет ответ, а второй агент проверяет, что каждое
        утверждение подтверждено текстом закона. {withDocument ? "Проверка договора обычно занимает до минуты." : "Обычно 10–30 секунд."}
      </p>
      <button onClick={onCancel} className="pressable t-caption mt-3 font-semibold text-accent-ink">
        Отменить
      </button>
    </div>
  );
}
