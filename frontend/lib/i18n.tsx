"use client";

// The interface language in the browser. The choice lives in a cookie so the
// server renders the page in it, without a flash of Russian first.

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type Dict, type Lang, LANG_COOKIE, getDict, isLang } from "./dict";

export { LANGS, type Dict, type Lang } from "./dict";

// For code outside React (API errors, chat titles): the language the user
// picked in this browser, read from the cookie the switcher writes.
export function currentLang(): Lang {
  if (typeof document === "undefined") return "ru";
  const saved = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`))?.[1];
  return isLang(saved) ? saved : "ru";
}
export const getT = () => getDict(currentLang());

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "ru", setLang: () => {} });

export function LangProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const router = useRouter();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback(
    (l: Lang) => {
      document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
      setLangState(l);
      router.refresh(); // server-rendered parts (the sign-in screen) follow the cookie
    },
    [router],
  );
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

export function useT(): Dict {
  return getDict(useContext(LangContext).lang);
}
