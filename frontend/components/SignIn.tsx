import Image from "next/image";
import Link from "next/link";
import { signIn } from "@/auth";

// Server component: the button posts a server action that starts Google OAuth.
export function SignIn() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="aurora" />
      </div>
      <div className="material-thick w-full max-w-sm rounded-[1.75rem] p-7 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full dark:bg-white/95">
          <Image src="/logo-mark.png" alt="" width={64} height={64} priority className="dark:scale-[0.84]" />
        </span>
        <h1 className="t-title mt-4">
          Qorgau<span className="text-gold-ink">AI</span>
        </h1>
        <p className="t-body mt-2 text-balance text-text-2">
          Ответы по Конституции и Трудовому кодексу РК — со ссылкой на каждую статью.
        </p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="pressable t-body flex w-full items-center justify-center gap-2.5 rounded-full bg-accent px-5 py-3 font-semibold text-white">
            <GoogleMark />
            Войти через Google
          </button>
        </form>
        <p className="t-caption mt-5 text-text-3">
          Вход нужен, чтобы сохранять историю и ограничить расходы: до 20 вопросов в день. Ответ — информация, а не
          юридическая консультация.
        </p>
        <Link href="/privacy" className="t-caption mt-3 inline-block font-medium text-accent-ink">
          Политика конфиденциальности
        </Link>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#fff" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#fff" fillOpacity=".85" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" />
      <path fill="#fff" fillOpacity=".7" d="M3.97 10.72A5.4 5.4 0 013.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#fff" fillOpacity=".55" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 009 0 9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
