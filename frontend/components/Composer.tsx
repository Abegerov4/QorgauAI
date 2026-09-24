"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { springSnappy } from "@/lib/motion";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAttach: (file: File) => void;
  onDetach: () => void;
  attachment: { name: string; uploading: boolean } | null;
  busy: boolean;
  placeholder: string;
};

export const ACCEPT = "application/pdf,image/jpeg,image/png";

export function Composer({ value, onChange, onSubmit, onAttach, onDetach, attachment, busy, placeholder }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const canSend = !busy && !attachment?.uploading && (value.trim().length > 0 || !!attachment);

  // Grow with the text, up to ~6 lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  }

  return (
    <div className="material-thick rounded-[1.625rem] p-1.5">
      <AnimatePresence initial={false}>
        {attachment && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springSnappy}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
              <span className="t-caption inline-flex max-w-full items-center gap-2 rounded-full bg-surface-2 py-1 pr-1 pl-3">
                <span className={`truncate ${attachment.uploading ? "shimmer" : ""}`}>
                  {attachment.uploading ? `Читаю ${attachment.name}…` : attachment.name}
                </span>
                {!attachment.uploading && (
                  <button
                    onClick={onDetach}
                    className="pressable grid size-5 place-items-center rounded-full bg-text-3/25 text-text-2"
                    aria-label="Убрать документ"
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
                      <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-1.5">
        <button
          onClick={() => file.current?.click()}
          disabled={!!attachment?.uploading}
          className="pressable grid size-10 shrink-0 place-items-center rounded-full text-text-2 hover:bg-surface-2 disabled:opacity-40"
          aria-label="Загрузить договор (PDF, JPG, PNG)"
          title="Загрузить договор (PDF, JPG, PNG)"
        >
          <svg width="18" height="20" viewBox="0 0 18 20" fill="none" aria-hidden>
            <path
              d="M16 9.5l-6.8 6.8a4.2 4.2 0 01-6-6l7.2-7.1a2.8 2.8 0 014 4l-7.1 7.1a1.4 1.4 0 01-2-2l6.4-6.4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <input
          ref={file}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onAttach(f);
            e.target.value = "";
          }}
        />
        <label htmlFor="question" className="sr-only">
          Вопрос
        </label>
        <textarea
          id="question"
          ref={area}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          maxLength={4000}
          className="t-body min-h-10 flex-1 resize-none bg-transparent py-2 outline-none placeholder:text-text-3"
        />
        <button
          onClick={onSubmit}
          disabled={!canSend}
          className="pressable grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white disabled:bg-text-3/30"
          aria-label="Отправить"
        >
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
            <path d="M7 14.5V2M1.5 7.5L7 2l5.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
