"use client";

import { motion, useReducedMotion } from "motion/react";

// Words fade in from a slight blur one after another, as if the answer were
// being written (after the Text Generate Effect on 21st.dev). The full text
// is laid out from the start, so nothing below it moves while it appears.
// Under reduced motion the text is shown at once.

type Props = { text: string; start: number; step: number; animate: boolean };

export function GenerateText({ text, start, step, animate }: Props) {
  const reduced = useReducedMotion();
  if (!animate || reduced) return <>{text}</>;
  let word = 0;
  return (
    <>
      {text.split(/(\s+)/).map((part, i) =>
        /^\s+$/.test(part) || part === "" ? (
          part
        ) : (
          <motion.span
            key={i}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ delay: start + word++ * step, duration: 0.35, ease: "easeOut" }}
          >
            {part}
          </motion.span>
        ),
      )}
    </>
  );
}

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;
