// Light or dark, kept on <html data-theme>. The saved choice wins; without one
// the page follows the system setting (and keeps following it live).

export type Theme = "light" | "dark";

const KEY = "theme";
const BAR: Record<Theme, string> = { light: "#f4f6f9", dark: "#040a14" };

// Runs inline in <head> before the first paint, so a saved dark theme never
// flashes light. Kept as plain ES5 in a string: it is not bundled.
export const themeScript = `(function(){
var r=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)");
function saved(){try{return localStorage.getItem("${KEY}")}catch(e){return null}}
function apply(){var t=saved();r.dataset.theme=t==="dark"||t==="light"?t:m.matches?"dark":"light"}
apply();m.addEventListener("change",apply);
})()`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private mode or blocked storage: the choice lasts until reload
  }
}

/** Calls back whenever data-theme changes, by the toggle or by the system. */
export function onThemeChange(cb: () => void): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** The browser bar colour follows the page theme, not only the system one. */
export function syncThemeColor(theme: Theme) {
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", BAR[theme]));
}
