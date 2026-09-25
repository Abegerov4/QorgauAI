"use client";

import { useEffect, useSyncExternalStore } from "react";
import { currentTheme, onThemeChange, setTheme, syncThemeColor } from "@/lib/theme";

// Sliding light/dark switch (adapted from a 21st.dev theme toggle): the moon
// sits on the left, the sun on the right, and the knob slides under whichever
// theme is on.
export function ThemeToggle({ className = "" }: { className?: string }) {
  // The server cannot know the theme; React re-renders with the real one
  // right after hydration.
  const theme = useSyncExternalStore(onThemeChange, currentTheme, () => null);
  const dark = theme === "dark";

  useEffect(() => {
    if (theme) syncThemeColor(theme);
  }, [theme]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Тёмная тема"
      title={dark ? "Включить светлую тему" : "Включить тёмную тему"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={`pressable relative flex h-8 w-15 shrink-0 items-center justify-between rounded-full border border-hairline bg-surface-2/70 p-1 ${className}`}
    >
      <span
        className={`absolute top-1 left-1 size-6 rounded-full bg-surface shadow-[var(--shadow-sm)] transition-transform duration-300 ease-out motion-reduce:transition-none ${
          dark ? "translate-x-0" : "translate-x-[26px]"
        } ${theme ? "" : "opacity-0"}`}
        aria-hidden
      />
      <span className={`relative grid size-6 place-items-center transition-colors duration-300 ${dark ? "text-accent-ink" : "text-text-3"}`} aria-hidden>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 9.6A5.75 5.75 0 016.4 2.5a5.75 5.75 0 107.1 7.1z" />
        </svg>
      </span>
      <span className={`relative grid size-6 place-items-center transition-colors duration-300 ${theme && !dark ? "text-gold-ink" : "text-text-3"}`} aria-hidden>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="2.75" />
          <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
        </svg>
      </span>
    </button>
  );
}
