"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { spring } from "@/lib/motion";

// Cycles through phrases in place: the old one slides up and blurs out, the
// next rises in (after Word Rotate on 21st.dev). Under reduced motion it
// shows only `still`, so nothing on the page keeps changing on its own.

type Props = { words: string[]; still: string; interval?: number; className?: string };

export function WordRotate({ words, still, interval = 2600, className }: Props) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => clearInterval(t);
  }, [reduced, words.length, interval]);

  if (reduced) return <span className={className}>{still}</span>;
  return (
    // The longest phrase reserves the width and height, so the line never jumps.
    <span className={`relative inline-grid ${className ?? ""}`} aria-live="off">
      <span className="invisible col-start-1 row-start-1" aria-hidden>
        {words.reduce((a, b) => (b.length > a.length ? b : a))}
      </span>
      <span className="sr-only">{still}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={words[i]}
          className="col-start-1 row-start-1"
          initial={{ y: "60%", opacity: 0, filter: "blur(6px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: "-60%", opacity: 0, filter: "blur(6px)" }}
          transition={spring}
          aria-hidden
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
