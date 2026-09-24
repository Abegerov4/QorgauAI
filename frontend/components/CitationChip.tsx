"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ArticleResponse } from "@/lib/api";
import { citedPoint, loadArticle } from "@/lib/articles";
import { citationLabel, parseCitation, type Citation } from "@/lib/citations";
import { springSnappy } from "@/lib/motion";

// A citation chip. Click opens the full article in the sheet (as before);
// hovering with a mouse or focusing with the keyboard shows the cited point
// in a small card first, so the reader can check a claim without leaving it.

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
const CARD_WIDTH = 340;
const GUTTER = 16;

type Props = { raw: string; onCite: (c: Citation) => void; className: string };

export function CitationChip({ raw, onCite, className }: Props) {
  const c = parseCitation(raw);
  const chip = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean; width: number } | null>(null);
  const id = useId();
  const previewable = c.kind === "law";

  const clear = () => clearTimeout(timer.current);
  const show = () => {
    const r = chip.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * GUTTER);
    const left = Math.min(Math.max(r.left, GUTTER), window.innerWidth - width - GUTTER);
    const above = r.top > 260; // room for the card above the chip, else below
    setPos({ left, top: above ? r.top - 8 : r.bottom + 8, above, width });
  };
  const openSoon = () => {
    clear();
    timer.current = setTimeout(show, OPEN_DELAY);
  };
  const closeSoon = () => {
    clear();
    timer.current = setTimeout(() => setPos(null), CLOSE_DELAY);
  };

  // A fixed card would drift away from its chip on scroll: close instead.
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  useEffect(() => clear, []);

  return (
    <>
      <button
        ref={chip}
        onClick={() => {
          clear();
          setPos(null);
          onCite(c);
        }}
        onPointerEnter={(e) => previewable && e.pointerType === "mouse" && openSoon()}
        onPointerLeave={(e) => previewable && e.pointerType === "mouse" && closeSoon()}
        onFocus={(e) => previewable && e.currentTarget.matches(":focus-visible") && show()}
        onBlur={() => previewable && setPos(null)}
        aria-describedby={pos ? id : undefined}
        title={previewable ? undefined : raw}
        className={className}
      >
        {citationLabel(c)}
      </button>
      {previewable &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {pos && (
              <motion.div
                id={id}
                role="tooltip"
                onPointerEnter={clear}
                onPointerLeave={closeSoon}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={springSnappy}
                className="material-thick fixed z-50 rounded-2xl p-4"
                style={{
                  left: pos.left,
                  top: pos.top,
                  width: pos.width,
                  translateY: pos.above ? "-100%" : 0,
                  transformOrigin: pos.above ? "bottom left" : "top left",
                }}
              >
                <Preview citation={c} />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

function Preview({ citation }: { citation: Extract<Citation, { kind: "law" }> }) {
  const [article, setArticle] = useState<ArticleResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadArticle(citation.codeKey, citation.article)
      .then((a) => alive && setArticle(a))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [citation.codeKey, citation.article]);

  const point = article && citedPoint(article, citation);
  return (
    <div>
      <p className="t-eyebrow text-gold-ink">
        {citation.codeShort}
        {citation.point && ` · ${citation.point}`}
      </p>
      <p className="t-body mt-1 leading-snug font-semibold">{article ? article.article : `Статья ${citation.article}`}</p>
      {failed ? (
        <p className="t-caption mt-2 text-text-2">Не удалось загрузить текст. Нажмите, чтобы открыть статью.</p>
      ) : point ? (
        <p className="t-caption mt-2 line-clamp-6 text-text">{point.text}</p>
      ) : (
        <div className="mt-2.5 space-y-2" aria-label="Загрузка статьи">
          {[100, 90, 70].map((w, i) => (
            <div key={i} className="h-3 animate-pulse rounded-full bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      <p className="t-caption mt-3 text-text-3">Нажмите на ссылку, чтобы открыть статью целиком</p>
    </div>
  );
}
