"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckIcon } from "@heroicons/react/16/solid";
import { useEffect, useRef, useState } from "react";
import { LANGS, useLang, useT } from "@/lib/i18n";
import { springSnappy } from "@/lib/motion";

// A compact pill with the current language (RU / KZ / EN) that opens a small
// menu, so it fits the header on a phone next to the other controls.
export function LanguageSwitcher({ className = "", up = false }: { className?: string; up?: boolean }) {
  const { lang, setLang } = useLang();
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = LANGS.find((l) => l.id === lang)!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.langLabel}: ${current.name}`}
        title={t.langLabel}
        className="pressable t-caption flex h-8 items-center gap-1 rounded-full border border-hairline bg-surface-2/70 px-2.5 font-semibold text-text-2 hover:text-text"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M1.75 8h12.5M8 1.75c1.7 1.8 2.5 3.9 2.5 6.25S9.7 12.45 8 14.25C6.3 12.45 5.5 10.35 5.5 8S6.3 3.55 8 1.75z" />
        </svg>
        {current.short}
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="menu"
            aria-label={t.langLabel}
            initial={{ opacity: 0, y: up ? 4 : -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: up ? 4 : -4, scale: 0.97 }}
            transition={springSnappy}
            className={`material-thick absolute right-0 z-50 min-w-36 rounded-2xl p-1 ${
              up ? "bottom-full mb-2" : "top-full mt-2"
            }`}
          >
            {LANGS.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={l.id === lang}
                  lang={l.id}
                  onClick={() => {
                    setLang(l.id);
                    setOpen(false);
                  }}
                  className="t-body flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left hover:bg-surface-2"
                >
                  <span className="t-caption w-6 font-semibold text-text-3">{l.short}</span>
                  <span className="flex-1">{l.name}</span>
                  {l.id === lang && <CheckIcon className="size-4 text-accent-ink" aria-hidden />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
