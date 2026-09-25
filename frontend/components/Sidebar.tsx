"use client";

import {
  ArrowRightStartOnRectangleIcon,
  ChartBarIcon,
  ChevronDoubleLeftIcon,
  ChevronUpDownIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions";
import type { ChatSummary, Me } from "@/lib/api";
import { groupChats } from "@/lib/history";
import { plural } from "@/lib/labels";
import { spring, springSheet, springSnappy } from "@/lib/motion";
import { Logo, Wordmark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

// Chat history on the left: brand, "new chat", the conversations grouped by
// day, and the account at the bottom. The layout follows Aceternity's sidebar
// on 21st.dev; the open chat is marked the "tree nav" way, with a gold diamond
// gliding along a thin rail. Fixed on laptops (can be hidden), a drawer on
// phones.

export type SignedInUser = { name: string | null; email: string; image: string | null };

type Props = {
  chats: ChatSummary[] | null; // null while loading
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  user: SignedInUser | null;
  me: Me | null;
};

export const SIDEBAR_WIDTH = "w-72"; // keep in step with lg:pl-72 / lg:left-72 in QorgauApp

export function Sidebar({
  open,
  onClose,
  hidden,
  onHide,
  ...body
}: Props & { open: boolean; onClose: () => void; hidden: boolean; onHide: () => void }) {
  // Esc closes the phone drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <AnimatePresence initial={false}>
        {!hidden && (
          <motion.aside
            key="desktop"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={spring}
            className={`material fixed inset-y-0 left-0 z-40 hidden ${SIDEBAR_WIDTH} border-r border-hairline lg:block`}
            aria-label="История чатов"
          >
            <SidebarBody {...body} onHide={onHide} />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-[var(--scrim)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              aria-hidden
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="История чатов"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={springSheet}
              className="material-thick absolute inset-y-0 left-0 w-[min(20rem,86vw)]"
            >
              <SidebarBody
                {...body}
                onClose={onClose}
                onSelect={(id) => {
                  body.onSelect(id);
                  onClose();
                }}
                onNew={() => {
                  body.onNew();
                  onClose();
                }}
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarBody({
  chats,
  activeId,
  onSelect,
  onNew,
  onDelete,
  user,
  me,
  onHide,
  onClose,
}: Props & { onHide?: () => void; onClose?: () => void }) {
  const groups = chats ? groupChats(chats) : [];
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-15 shrink-0 items-center gap-2 px-4">
        <Logo size={30} />
        <Wordmark />
        {onHide && (
          <IconButton label="Скрыть историю" onClick={onHide} className="ml-auto">
            <ChevronDoubleLeftIcon className="size-4" />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Закрыть" onClick={onClose} className="ml-auto">
            <XMarkIcon className="size-5" />
          </IconButton>
        )}
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={onNew}
          className="pressable t-body flex w-full items-center justify-center gap-2 rounded-full border border-hairline bg-surface px-4 py-2.5 font-semibold text-text shadow-[var(--shadow-sm)] hover:text-accent-ink"
        >
          <PencilSquareIcon className="size-[18px]" aria-hidden />
          Новый чат
        </button>
      </div>

      <nav className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="Чаты">
        {chats === null ? (
          <div className="space-y-3 px-2 pt-3" aria-label="Загрузка чатов">
            {[80, 65, 90, 55].map((w, i) => (
              <div key={i} className="h-3 animate-pulse rounded-full bg-surface-2" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="t-caption px-2 pt-3 text-text-3">Здесь появятся ваши чаты: по одному на каждую тему.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mt-3 first:mt-1">
              <h3 className="t-eyebrow px-2 pb-1.5 text-text-3">{g.label}</h3>
              <ul className="relative ml-2 border-l border-hairline">
                {g.chats.map((c) => (
                  <ChatRow key={c.id} chat={c} active={c.id === activeId} onSelect={onSelect} onDelete={onDelete} />
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

      <div className="shrink-0 border-t border-hairline p-3">
        <div className="flex items-center gap-2">
          {user ? (
            <Account user={user} me={me} />
          ) : (
            <p className="t-caption min-w-0 flex-1 px-1 text-text-3">Локальный режим, без входа</p>
          )}
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function ChatRow({
  chat,
  active,
  onSelect,
  onDelete,
}: {
  chat: ChatSummary;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="group relative" onMouseLeave={() => setConfirm(false)}>
      {active && (
        <motion.span
          layoutId="chat-marker"
          transition={springSnappy}
          className="absolute top-1/2 -left-[4.5px] z-10 size-2 -translate-y-1/2 rotate-45 rounded-[2px] bg-gold shadow-[0_0_8px_var(--gold)]"
          aria-hidden
        />
      )}
      <button
        onClick={() => onSelect(chat.id)}
        aria-current={active ? "page" : undefined}
        title={chat.title}
        className={`ml-2 block w-[calc(100%-0.5rem)] truncate rounded-xl py-2 pr-9 pl-2.5 text-[0.9375rem] leading-snug text-left transition-colors ${
          active ? "bg-surface-2 font-medium text-text" : "text-text-2 hover:bg-surface-2/60 hover:text-text"
        }`}
      >
        {chat.title}
      </button>
      <div className="absolute inset-y-0 right-1 flex items-center">
        {confirm ? (
          <button
            onClick={() => onDelete(chat.id)}
            className="pressable t-caption rounded-lg bg-red-soft px-2 py-1 font-semibold text-red"
            autoFocus
          >
            Удалить
          </button>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className="pressable grid size-7 place-items-center rounded-lg text-text-3 opacity-0 group-hover:opacity-100 hover:bg-red-soft hover:text-red focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={`Удалить чат «${chat.title}»`}
            title="Удалить чат"
          >
            <TrashIcon className="size-4" />
          </button>
        )}
      </div>
    </li>
  );
}

function Account({ user, me }: { user: SignedInUser; me: Me | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => root.current?.contains(e.target as Node) || setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const initial = (user.name || user.email).trim()[0]?.toUpperCase() ?? "?";
  const left = me && me.daily_limit !== null ? Math.max(0, me.daily_limit - me.questions_today) : null;
  const quota =
    me === null
      ? user.email
      : left === null
        ? `Администратор · сегодня ${me.questions_today}`
        : `Осталось ${left} ${plural(left, "вопрос", "вопроса", "вопросов")} из ${me.daily_limit}`;

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Меню аккаунта"
        className="pressable flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left hover:bg-surface-2"
      >
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft font-semibold text-accent-ink">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- a Google avatar; next/image would need its host allow-listed
            <img src={user.image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
          ) : (
            <span className="t-caption">{initial}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="t-caption block truncate font-semibold text-text">{user.name ?? user.email}</span>
          <span className="t-caption block truncate text-text-3">{quota}</span>
        </span>
        <ChevronUpDownIcon className="size-4 shrink-0 text-text-3" aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={springSnappy}
            className="material-thick absolute bottom-12 left-0 z-50 w-64 origin-bottom-left rounded-2xl p-2"
          >
            <p className="t-caption truncate px-2.5 pt-1 pb-2 text-text-2">{user.email}</p>
            <div className="border-t border-hairline pt-1.5">
              {me?.role === "admin" && (
                <Link href="/admin" role="menuitem" className="t-body flex items-center gap-2 rounded-xl px-2.5 py-2 hover:bg-surface-2">
                  <ChartBarIcon className="size-4 text-text-2" aria-hidden />
                  Статистика
                </Link>
              )}
              <form action={signOutAction}>
                <button
                  type="submit"
                  role="menuitem"
                  className="t-body flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-red hover:bg-red-soft"
                >
                  <ArrowRightStartOnRectangleIcon className="size-4" aria-hidden />
                  Выйти
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`pressable grid size-8 place-items-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text ${className}`}
    >
      {children}
    </button>
  );
}
