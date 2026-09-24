"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { DocumentResponse } from "@/lib/api";
import { DOC_TYPE_LABELS, PII_LABELS, TOPIC_LABELS, plural } from "@/lib/labels";
import { spring } from "@/lib/motion";

export function DocumentCard({ doc }: { doc: DocumentResponse }) {
  const [open, setOpen] = useState(false);
  const vision = doc.pages.filter((p) => p.method === "vision").length;
  const pages = doc.pages.length;

  return (
    <article className="card p-5 sm:p-6">
      <div className="flex items-start gap-3.5">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden>
          <DocIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-eyebrow text-text-3">{DOC_TYPE_LABELS[doc.document_type] ?? "Документ"}</p>
          <h3 className="t-title mt-0.5 truncate">{doc.filename}</h3>
          <p className="t-caption mt-1 text-text-2">
            {pages} {plural(pages, "страница", "страницы", "страниц")}
            {vision > 0 ? ` · ${vision} распознано Vision OCR` : " · текстовый слой"} · {doc.clauses.length}{" "}
            {plural(doc.clauses.length, "пункт", "пункта", "пунктов")}
          </p>
        </div>
      </div>

      {doc.pii_found.length > 0 && (
        <p className="t-caption mt-4 flex gap-2 rounded-2xl bg-green-soft px-3.5 py-2.5 text-text">
          <LockIcon />
          <span>
            Скрыто до отправки в модель: {doc.pii_found.map((k) => PII_LABELS[k] ?? k).join(", ")}
          </span>
        </p>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable t-caption mt-4 font-semibold text-accent-ink"
      >
        {open ? "Скрыть пункты" : "Показать извлечённые пункты"}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <ul className="mt-3 divide-y divide-hairline">
              {doc.clauses.map((c) => (
                <li key={c.clause_number} className="grid grid-cols-[2.25rem_1fr] gap-x-2 py-2.5">
                  <span className="t-caption pt-0.5 font-semibold text-text-3">{c.clause_number}</span>
                  <div>
                    <p className="t-caption font-medium text-text-2">{TOPIC_LABELS[c.topic] ?? c.topic}</p>
                    <p className="t-caption mt-0.5 text-text">{c.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function DocIcon() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" fill="none">
      <path d="M4 1h8l6 6v12a2 2 0 01-2 2H4a2 2 0 01-2-2V3a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 1v6h6M6 12h8M6 16h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" className="mt-0.5 shrink-0 text-green" aria-hidden>
      <rect x="1" y="7" width="12" height="8" rx="2" fill="currentColor" />
      <path d="M4 7V4.5a3 3 0 016 0V7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
