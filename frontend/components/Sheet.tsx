"use client";

import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { project, spring, springSheet } from "@/lib/motion";

type Props = { open: boolean; onClose: () => void; label: string; children: ReactNode; side?: boolean };

const WIDE = "(min-width: 64rem)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

// Bottom sheet: enters from and exits to the bottom edge (same path both ways),
// is dragged 1:1 by its grabber, and on release decides close vs. stay from the
// *projected* resting point, so a short fast flick dismisses it too.
// With `side`, on laptops it is a full-height panel on the right instead, so
// the content it explains stays visible next to it.
export function Sheet({ open, onClose, label, children, side = false }: Props) {
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  const right = side && wide;
  const controls = useDragControls();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  function onDragEnd(_: unknown, info: PanInfo) {
    const height = panel.current?.offsetHeight ?? 600;
    const resting = info.offset.y + project(info.velocity.y);
    if (resting > height * 0.4) onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <div className={`fixed inset-0 z-50 flex ${right ? "items-stretch justify-end" : "items-end justify-center"}`}>
          <motion.div
            className="absolute inset-0"
            style={{ background: "var(--scrim)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className={`material-thick relative flex flex-col outline-none ${
              right ? "h-full w-[30rem] max-w-[90vw] rounded-l-[1.75rem]" : "max-h-[85dvh] w-full max-w-2xl rounded-t-[1.75rem]"
            }`}
            initial={right ? { x: "100%" } : { y: "100%" }}
            animate={right ? { x: 0 } : { y: 0 }}
            exit={right ? { x: "100%" } : { y: "100%" }}
            transition={springSheet}
            drag={right ? false : "y"}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 1 }}
            dragMomentum={false}
            onDragEnd={onDragEnd}
          >
            {right ? (
              <div className="h-12 shrink-0" />
            ) : (
              <div
                className="flex cursor-grab touch-none justify-center pt-2.5 pb-1 active:cursor-grabbing"
                onPointerDown={(e) => controls.start(e)}
              >
                <span className="h-1.5 w-10 rounded-full bg-text-3/40" />
              </div>
            )}
            <button
              onClick={onClose}
              className="pressable absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-surface-2 text-text-2"
              aria-label="Закрыть"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <div className="overflow-y-auto overscroll-contain px-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
