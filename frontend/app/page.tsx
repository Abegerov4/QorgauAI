import { cookies } from "next/headers";
import { connection } from "next/server";
import { auth, authEnabled } from "@/auth";
import { QorgauApp } from "@/components/QorgauApp";
import { SignIn } from "@/components/SignIn";
import { LANG_COOKIE, isLang } from "@/lib/dict";
import { LangProvider } from "@/lib/i18n";

// Signed out -> the sign-in screen; signed in (or the open local mode) -> the app.
export default async function Page() {
  // Per request: whether sign-in is on depends on runtime env (Google keys set
  // on the host), which a build-time prerender would freeze.
  await connection();
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = isLang(saved) ? saved : "ru";
  const session = authEnabled ? await auth() : null;
  const user = session?.user ? { name: session.user.name ?? null, email: session.user.email!, image: session.user.image ?? null } : null;
  return (
    <LangProvider initial={lang}>
      {authEnabled && !session?.user?.email ? <SignIn lang={lang} /> : <QorgauApp user={user} />}
    </LangProvider>
  );
}
