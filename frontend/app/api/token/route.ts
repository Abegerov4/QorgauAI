import { SignJWT } from "jose";
import { auth, authEnabled } from "@/auth";

// Exchanges the Auth.js session (a cookie on this site) for a short-lived
// token the API on another origin can verify with the shared secret. The
// browser then calls the API directly, so answers still stream.

const TTL_SECONDS = 60 * 60;

export async function GET() {
  if (!authEnabled) return new Response(null, { status: 204 }); // open local mode: no token needed
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return Response.json({ detail: "Войдите, чтобы задавать вопросы." }, { status: 401 });
  const secret = process.env.BACKEND_JWT_SECRET;
  if (!secret) return Response.json({ detail: "BACKEND_JWT_SECRET не задан." }, { status: 500 });

  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const token = await new SignJWT({ name: session.user?.name ?? undefined })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuer("qorgau-web")
    .setAudience("qorgau-api")
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));
  return Response.json({ token, expiresAt }, { headers: { "Cache-Control": "no-store" } });
}
