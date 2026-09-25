"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api, type AdminStats } from "@/lib/api";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminStats()
      .then(setStats)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/" className="t-caption font-medium text-accent-ink">
        ← К помощнику
      </Link>
      <h1 className="t-display mt-3">Статистика</h1>

      {error && <p className="card t-body mt-6 p-5 text-red">{error}</p>}
      {!stats && !error && <p className="t-body shimmer mt-6">Загружаю…</p>}

      {stats && (
        <>
          <section className="mt-6 grid gap-2.5 sm:grid-cols-4">
            <Stat label="Потрачено сегодня" value={usd(stats.today.spent_usd)} hint={`из ${usd(stats.today.budget_usd)} бюджета`} />
            <Stat label="Вопросов за 7 дней" value={String(stats.week.questions)} hint={`${usd(stats.week.cost_usd)}`} />
            <Stat label="Пользователей" value={String(stats.users_total)} hint={`${stats.week.active_users} активны за неделю`} />
            <Stat
              label="Полезных ответов"
              value={stats.week.helpful + stats.week.not_helpful ? `${Math.round((100 * stats.week.helpful) / (stats.week.helpful + stats.week.not_helpful))}%` : "—"}
              hint={`👍 ${stats.week.helpful} · 👎 ${stats.week.not_helpful}`}
            />
          </section>

          <section className="card mt-4 p-5">
            <h2 className="t-title">Сегодня по пользователям</h2>
            <p className="t-caption mt-1 text-text-3">Лимит — {stats.today.per_user_limit} вопросов в день на человека.</p>
            {stats.today.users.length === 0 ? (
              <p className="t-body mt-3 text-text-2">Сегодня вопросов ещё не было.</p>
            ) : (
              <table className="t-body mt-3 w-full">
                <thead>
                  <tr className="t-caption text-left text-text-3">
                    <th className="py-1.5 font-medium">Пользователь</th>
                    <th className="py-1.5 text-right font-medium">Вопросов</th>
                    <th className="py-1.5 text-right font-medium">Стоимость</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.today.users.map((u) => (
                    <tr key={u.email} className="border-t border-hairline">
                      <td className="max-w-0 truncate py-2 pr-3">{u.email}</td>
                      <td className="py-2 text-right tabular-nums">{u.questions}</td>
                      <td className="py-2 text-right tabular-nums">{usd(u.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card mt-4 p-5">
            <h2 className="t-title">Последние 👎</h2>
            <p className="t-caption mt-1 text-text-3">Кандидаты в golden dataset: что сломалось и почему.</p>
            {stats.negative_feedback.length === 0 ? (
              <p className="t-body mt-3 text-text-2">Отрицательных оценок пока нет.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {stats.negative_feedback.map((f) => (
                  <li key={f.trace_id + f.created_at} className="rounded-2xl bg-surface-2 p-3.5">
                    <p className="t-body">{f.question ?? "—"}</p>
                    {f.comment && <p className="t-caption mt-1 text-text">«{f.comment}»</p>}
                    <p className="t-caption mt-1.5 flex flex-wrap gap-x-3 text-text-3">
                      <span>{f.user_email}</span>
                      <span>{new Date(f.created_at).toLocaleString("ru-RU")}</span>
                      {f.trace_url && (
                        <a href={f.trace_url} target="_blank" rel="noreferrer" className="font-medium text-accent-ink">
                          Трейс в Langfuse ↗
                        </a>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-4">
      <p className="t-caption text-text-2">{label}</p>
      <p className="mt-1 text-[1.5rem] leading-tight font-semibold tabular-nums">{value}</p>
      <p className="t-caption mt-0.5 text-text-3">{hint}</p>
    </div>
  );
}
