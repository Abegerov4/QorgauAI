"use client";

import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { api, type SearchChunk, type SearchResponse } from "@/lib/api";
import { parseCitation, type Citation } from "@/lib/citations";
import { spring } from "@/lib/motion";

const EXAMPLES = ["продолжительность основного отпуска", "испытательный срок", "сверхурочная работа оплата", "Курултай"];

type Results = { dense: SearchResponse; hybrid: SearchResponse };

// Retrieval-only A/B view: pipeline A (dense) next to pipeline B (hybrid
// dense + BM25 with RRF). Costs one embedding call per query, no LLM.
export function SearchCompare({ onCite }: { onCite: (c: Citation) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(q: string) {
    if (!q.trim()) return;
    setQuery(q);
    setBusy(true);
    setError(null);
    try {
      const [dense, hybrid] = await Promise.all([api.search(q, "dense"), api.search(q, "hybrid")]);
      setResults({ dense, hybrid });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(query);
  }

  const denseKeys = new Set(results?.dense.results.map(key));
  const hybridKeys = new Set(results?.hybrid.results.map(key));

  return (
    <div>
      <h1 className="t-display">Сравнение поиска</h1>
      <p className="t-body mt-2 max-w-xl text-text-2">
        Один запрос — два способа найти нормы. Слева только смысловой поиск по эмбеддингам, справа гибридный:
        эмбеддинги плюс BM25 по словам со стеммингом, объединённые через RRF.
      </p>

      <form onSubmit={onSubmit} className="material-thick mt-6 flex items-center gap-1.5 rounded-full p-1.5 pl-5">
        <label htmlFor="search" className="sr-only">
          Поисковый запрос
        </label>
        <input
          id="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Например: испытательный срок"
          className="t-body min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-3"
        />
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="pressable t-caption h-10 rounded-full bg-accent px-5 font-semibold text-white disabled:bg-text-3/30"
        >
          {busy ? "Ищу…" : "Найти"}
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => run(ex)} className="pressable t-caption rounded-full bg-surface px-3 py-1.5 text-text-2 shadow-[var(--shadow-sm)]">
            {ex}
          </button>
        ))}
      </div>

      {error && <p className="t-body mt-6 text-red">{error}</p>}

      {results && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Column
            title="A · Dense"
            subtitle="text-embedding-3-large"
            items={results.dense.results}
            others={hybridKeys}
            onCite={onCite}
          />
          <Column
            title="B · Hybrid"
            subtitle="Dense + BM25, RRF"
            items={results.hybrid.results}
            others={denseKeys}
            onCite={onCite}
          />
        </div>
      )}
    </div>
  );
}

function key(c: SearchChunk) {
  return `${c.code}|${c.article_number}|${c.point}`;
}

function citationOf(c: SearchChunk) {
  return [c.code, `Статья ${c.article_number}`, c.point].filter(Boolean).join(", ");
}

function Column({
  title,
  subtitle,
  items,
  others,
  onCite,
}: {
  title: string;
  subtitle: string;
  items: SearchChunk[];
  others: Set<string>;
  onCite: (c: Citation) => void;
}) {
  return (
    <section>
      <h2 className="t-title">{title}</h2>
      <p className="t-caption text-text-3">{subtitle}</p>
      <ol className="mt-3 space-y-2.5">
        {items.map((c, i) => {
          const unique = !others.has(key(c));
          return (
            <motion.li
              key={key(c)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: i * 0.03 }}
            >
              <button
                onClick={() => onCite(parseCitation(citationOf(c)))}
                className="pressable card block w-full p-4 text-left"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-caption font-semibold">
                    {i + 1}. {c.code.startsWith("Конституция") ? "Конституция" : "ТК"}, ст. {c.article_number}
                    {c.point && <span className="font-normal text-text-2"> · {c.point}</span>}
                  </span>
                  <span className="t-caption shrink-0 tabular-nums text-text-3">{c.score.toFixed(3)}</span>
                </div>
                <p className="t-caption mt-1.5 line-clamp-3 text-text-2">{c.text}</p>
                {unique && (
                  <span className="t-caption mt-2 inline-block rounded-full bg-gold-soft px-2 py-0.5 font-medium text-gold-ink">
                    только здесь
                  </span>
                )}
              </button>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
