import { connection } from "next/server";
import { auth, authEnabled } from "@/auth";
import { QorgauApp } from "@/components/QorgauApp";
import { SignIn } from "@/components/SignIn";

// Signed out -> the sign-in screen; signed in (or the open local mode) -> the app.
export default async function Page() {
  // Per request: whether sign-in is on depends on runtime env (Google keys set
  // on the host), which a build-time prerender would freeze.
  await connection();
  const session = authEnabled ? await auth() : null;
  if (authEnabled && !session?.user?.email) return <SignIn />;
  const user = session?.user ? { name: session.user.name ?? null, email: session.user.email!, image: session.user.image ?? null } : null;
  return <QorgauApp user={user} />;
}
