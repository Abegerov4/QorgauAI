"use client";

import { ChevronDownIcon, ChevronUpIcon, MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { HandThumbDownIcon, HandThumbUpIcon } from "@heroicons/react/16/solid";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, type AdminQuestion, type AdminUser } from "@/lib/api";
import { Sheet } from "./Sheet";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `сегодня ${time}`;
  today.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `вчера ${time}`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

type SortKey = "name" | "questions" | "today" | "cost" | "votes" | "seen";
const SORT: Record<SortKey, (u: AdminUser) => number | string> = {
  name: (u) => (u.name || u.email).toLowerCase(),
  questions: (u) => u.questions,
  today: (u) => u.questions_today,
  cost: (u) => u.cost_usd,
  votes: (u) => u.helpful + u.not_helpful,
  seen: (u) => u.last_seen_at,
};
const COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "name", label: "Пользователь" },
  { key: "questions", label: "Вопросов", right: true },
  { key: "today", label: "Сегодня", right: true },
  { key: "cost", label: "Потрачено", right: true },
  { key: "votes", label: "Оценки", right: true },
  { key: "seen", label: "Заходил", right: true },
];

type Filter = "all" | "today" | "blocked";
const FILTERS: { key: Filter; label: string; test: (u: AdminUser) => boolean }[] = [
  { key: "all", label: "Все", test: () => true },
  { key: "today", label: "Активны сегодня", test: (u) => u.questions_today > 0 },
  { key: "blocked", label: "Заблокированы", test: (u) => u.blocked },
];

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [defaultLimit, setDefaultLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "seen", desc: true });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminUsers()
      .then((r) => {
        setUsers(r.users);
        setDefaultLimit(r.default_limit);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  const shown = useMemo(() => {
    if (!users) return [];
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    const get = SORT[sort.key];
    return users
      .filter((u) => test(u) && (!q || u.email.includes(q) || (u.name ?? "").toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = get(a), y = get(b);
        const cmp = x < y ? -1 : x > y ? 1 : 0;
        return sort.desc ? -cmp : cmp;
      });
  }, [users, query, filter, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  const updated = (u: AdminUser) => setUsers((all) => all && all.map((x) => (x.email === u.email ? u : x)));

  return (
    <section className="card mt-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-title">Пользователи</h2>
        {users && <p className="t-caption text-text-3">{shown.length} из {users.length}</p>}
      </div>
      <p className="t-caption mt-1 text-text-3">Нажмите на строку: вопросы, оценки, лимит и блокировка.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-full bg-surface-2 px-3.5 py-2">
          <MagnifyingGlassIcon className="size-4 shrink-0 text-text-3" aria-hidden />
          <span className="sr-only">Поиск по почте или имени</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Почта или имя"
            className="t-body min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-3"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`pressable t-caption rounded-full px-3 py-1.5 font-medium whitespace-nowrap ${
                filter === f.key ? "bg-accent text-white" : "bg-surface-2 text-text-2 hover:text-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="t-body mt-3 text-red">{error}</p>}
      {!users && !error && <p className="t-body shimmer mt-3">Загружаю…</p>}
      {users && shown.length === 0 && <p className="t-body mt-3 text-text-2">Никого не нашлось.</p>}

      {shown.length > 0 && (
        <div className="-mx-5 mt-3 overflow-x-auto px-5">
          <table className="t-body w-full min-w-[40rem]">
            <thead>
              <tr className="t-caption text-text-3">
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
                    className={`py-1.5 font-medium ${c.right ? "text-right" : "w-[36%] text-left"}`}
                  >
                    <button
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-0.5 hover:text-text ${sort.key === c.key ? "text-text" : ""}`}
                    >
                      {c.label}
                      {sort.key === c.key &&
                        (sort.desc ? <ChevronDownIcon className="size-3.5" aria-hidden /> : <ChevronUpIcon className="size-3.5" aria-hidden />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr
                  key={u.email}
                  onClick={() => setOpen(u.email)}
                  className={`cursor-pointer border-t border-hairline hover:bg-surface-2 ${u.blocked ? "text-text-3" : ""}`}
                >
                  <td className="max-w-0 py-2 pr-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(u.email);
                      }}
                      className="block w-full truncate text-left font-medium"
                    >
                      {u.name || u.email}
                    </button>
                    <span className="t-caption flex items-center gap-1.5 truncate text-text-3">
                      {u.name && <span className="truncate">{u.email}</span>}
                      {u.role === "admin" && <Badge tone="accent">админ</Badge>}
                      {u.blocked && <Badge tone="red">заблокирован</Badge>}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{u.questions}</td>
                  <td className="py-2 text-right tabular-nums">
                    {u.questions_today}
                    <span className="text-text-3">/{u.question_limit ?? "∞"}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{usd(u.cost_usd)}</td>
                  <td className="py-2 text-right">
                    <Votes helpful={u.helpful} notHelpful={u.not_helpful} />
                  </td>
                  <td className="t-caption py-2 text-right whitespace-nowrap text-text-2">{when(u.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} label="Пользователь" side>
        {open && <UserPanel key={open} email={open} defaultLimit={defaultLimit} onUpdated={updated} />}
      </Sheet>
    </section>
  );
}

function Badge({ tone, children }: { tone: "accent" | "red"; children: React.ReactNode }) {
  const cls = tone === "red" ? "bg-red-soft text-red" : "bg-accent-soft text-accent-ink";
  return <span className={`shrink-0 rounded-full px-1.5 py-px text-[0.6875rem] font-semibold ${cls}`}>{children}</span>;
}

function Votes({ helpful, notHelpful }: { helpful: number; notHelpful: number }) {
  if (!helpful && !notHelpful) return <span className="text-text-3">—</span>;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="flex items-center gap-0.5 text-green" title="Полезно">
        <HandThumbUpIcon className="size-3.5" aria-hidden />
        {helpful}
      </span>
      <span className="flex items-center gap-0.5 text-red" title="Бесполезно">
        <HandThumbDownIcon className="size-3.5" aria-hidden />
        {notHelpful}
      </span>
    </span>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  answered: { label: "Ответ", cls: "bg-green-soft text-green" },
  partial: { label: "Частично", cls: "bg-gold-soft text-gold-ink" },
  refused: { label: "Отказ", cls: "bg-surface-2 text-text-2" },
  error: { label: "Ошибка", cls: "bg-red-soft text-red" },
  cancelled: { label: "Прерван", cls: "bg-surface-2 text-text-3" },
  document: { label: "Документ", cls: "bg-accent-soft text-accent-ink" },
  review: { label: "Проверка договора", cls: "bg-accent-soft text-accent-ink" },
};

function UserPanel({ email, defaultLimit, onUpdated }: { email: string; defaultLimit: number; onUpdated: (u: AdminUser) => void }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  useEffect(() => {
    api
      .adminUser(email)
      .then((r) => {
        setUser(r.user);
        setQuestions(r.questions);
        setLimit(r.user.daily_limit?.toString() ?? "");
      })
      .catch((e: ApiError) => setError(e.message));
  }, [email]);

  async function change(changes: { blocked?: boolean; daily_limit?: number | null }) {
    setSaving(true);
    setError(null);
    try {
      const u = await api.adminUpdateUser(email, changes);
      setUser(u);
      setLimit(u.daily_limit?.toString() ?? "");
      onUpdated(u);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
      setConfirmBlock(false);
    }
  }

  if (!user) return error ? <p className="t-body text-red">{error}</p> : <p className="t-body shimmer">Загружаю…</p>;

  const parsed = Number(limit);
  const limitValid = limit === "" || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000);
  const limitChanged = (limit === "" ? null : parsed) !== user.daily_limit;

  return (
    <div className="pb-2">
      <h3 className="t-title pr-10">{user.name || user.email}</h3>
      <p className="t-caption mt-0.5 flex flex-wrap items-center gap-1.5 text-text-2">
        {user.email}
        {user.role === "admin" && <Badge tone="accent">админ</Badge>}
        {user.blocked && <Badge tone="red">заблокирован</Badge>}
      </p>
      <p className="t-caption mt-1 text-text-3">
        Регистрация {when(user.created_at)} · заходил {when(user.last_seen_at)}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Mini label="Вопросов всего" value={String(user.questions)} />
        <Mini label="Сегодня" value={`${user.questions_today} / ${user.question_limit ?? "∞"}`} />
        <Mini label="Потрачено" value={usd(user.cost_usd)} />
        <Mini label="Оценки" value={<Votes helpful={user.helpful} notHelpful={user.not_helpful} />} />
      </div>

      {user.role !== "admin" && (
        <div className="mt-4 rounded-2xl bg-surface-2 p-3.5">
          <p className="t-caption font-semibold text-text-2">Управление</p>
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (limitValid && limitChanged) change({ daily_limit: limit === "" ? null : parsed });
            }}
          >
            <label htmlFor="limit" className="t-body text-text-2">
              Вопросов в день
            </label>
            <input
              id="limit"
              type="number"
              min={1}
              max={1000}
              inputMode="numeric"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder={String(defaultLimit)}
              aria-invalid={!limitValid}
              className={`t-body w-20 rounded-xl border bg-surface px-2.5 py-1.5 tabular-nums outline-none ${
                limitValid ? "border-hairline focus:border-accent" : "border-red"
              }`}
            />
            <button
              type="submit"
              disabled={saving || !limitValid || !limitChanged}
              className="pressable t-caption rounded-full bg-accent px-3.5 py-1.5 font-semibold text-white disabled:bg-text-3/30"
            >
              Сохранить
            </button>
            {user.daily_limit !== null && (
              <button
                type="button"
                disabled={saving}
                onClick={() => change({ daily_limit: null })}
                className="pressable t-caption rounded-full px-2 py-1.5 font-medium text-accent-ink"
              >
                Сбросить ({defaultLimit})
              </button>
            )}
          </form>
          <p className="t-caption mt-1 text-text-3">Пусто — общий лимит {defaultLimit}. Счётчик обнуляется в полночь UTC.</p>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
            {user.blocked ? (
              <button
                disabled={saving}
                onClick={() => change({ blocked: false })}
                className="pressable t-caption rounded-full bg-green-soft px-3.5 py-1.5 font-semibold text-green"
              >
                Разблокировать
              </button>
            ) : confirmBlock ? (
              <>
                <button
                  disabled={saving}
                  onClick={() => change({ blocked: true })}
                  className="pressable t-caption rounded-full bg-red px-3.5 py-1.5 font-semibold text-white"
                >
                  Да, заблокировать
                </button>
                <button onClick={() => setConfirmBlock(false)} className="pressable t-caption px-2 py-1.5 font-medium text-text-2">
                  Отмена
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmBlock(true)}
                className="pressable t-caption rounded-full bg-red-soft px-3.5 py-1.5 font-semibold text-red"
              >
                Заблокировать
              </button>
            )}
            <span className="t-caption text-text-3">
              {user.blocked ? "Не может пользоваться сервисом." : "Заблокированный не сможет задавать вопросы и открывать чаты."}
            </span>
          </div>
          {error && <p className="t-caption mt-2 text-red">{error}</p>}
        </div>
      )}

      <h4 className="t-body mt-5 font-semibold">
        Вопросы <span className="font-normal text-text-3">{questions.length < user.questions ? `последние ${questions.length}` : questions.length}</span>
      </h4>
      {questions.length === 0 ? (
        <p className="t-body mt-2 text-text-2">Вопросов ещё не было.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {questions.map((q) => {
            const s = (q.status && STATUS[q.status]) || { label: q.status ?? "—", cls: "bg-surface-2 text-text-2" };
            return (
              <li key={q.id} className="rounded-2xl bg-surface-2 p-3">
                <p className="t-body break-words">{q.question}</p>
                {q.comment && <p className="t-caption mt-1 text-text">«{q.comment}»</p>}
                <p className="t-caption mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-text-3">
                  <span className={`rounded-full px-1.5 py-px text-[0.6875rem] font-semibold ${s.cls}`}>{s.label}</span>
                  {q.helpful !== null &&
                    (q.helpful ? (
                      <HandThumbUpIcon className="size-3.5 text-green" aria-label="Полезно" />
                    ) : (
                      <HandThumbDownIcon className="size-3.5 text-red" aria-label="Бесполезно" />
                    ))}
                  <span>{when(q.created_at)}</span>
                  <span className="tabular-nums">{usd(q.cost_usd)}</span>
                  {q.trace_url && (
                    <a href={q.trace_url} target="_blank" rel="noreferrer" className="font-medium text-accent-ink">
                      Трейс ↗
                    </a>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <p className="t-caption text-text-3">{label}</p>
      <div className="mt-0.5 text-[1.0625rem] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
