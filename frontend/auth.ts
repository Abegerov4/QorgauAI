import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Sign-in with Google (Auth.js). Without Google credentials (local dev) the app
// runs open and the API treats every caller as the local admin.
export const authEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: authEnabled ? [Google] : [],
  // Railway terminates TLS in front of the container, so the request host is
  // the public one; Auth.js must trust it to build the Google callback URL.
  trustHost: true,
  pages: { signIn: "/" },
});
