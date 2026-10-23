"use client";

import { useEffect, useRef, useState } from "react";
import type { ArticleResponse, Clause } from "@/lib/api";
import { loadArticle } from "@/lib/articles";
import type { Citation } from "@/lib/citations";
import { useLang, useT } from "@/lib/i18n";

type Props = { citation: Citation; clauses: Clause[] };

export function CitationView({ citation, clauses }: Props) {
  const t = useT();
  if (citation.kind === "doc") {
    const clause = clauses.find((c) => c.clause_number === citation.clause);
    return (
      <div className="pb-2">
        <p className="t-eyebrow text-text-3">{t.yourContract}</p>
        <h2 className="t-title mt-1 pr-10">{t.clause(citation.clause)}</h2>
        {clause ? (
          <>
            <p className="t-caption mt-1 text-text-2">{t.topics[clause.topic] ?? clause.topic}</p>
            <p className="t-body mt-4 whitespace-pre-line">{clause.text}</p>
          </>
        ) : (
          <p className="t-body mt-4 text-text-2">{t.clauseUnavailable}</p>
        )}
      </div>
    );
  }
  if (citation.kind === "tool") {
    return (
      <div className="pb-2">
        <p className="t-eyebrow text-text-3">{t.tool}</p>
        <h2 className="t-title mt-1 pr-10">{t.calculator}</h2>
        <p className="t-body mt-4 text-text-2">{citation.raw}</p>
      </div>
    );
  }
  return <ArticleView citation={citation} />;
}

function ArticleView({ citation }: { citation: Extract<Citation, { kind: "law" }> }) {
  const t = useT();
  const { lang } = useLang();
  // Kazakh and English readers see a machine translation; one tap shows the official Russian.
  const [original, setOriginal] = useState(false);
  const shown = original ? "ru" : lang;
  const [article, setArticle] = useState<ArticleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const highlighted = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadArticle(citation.codeKey, citation.article, shown)
      .then((a) => alive && setArticle(a))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [citation.codeKey, citation.article, shown]);

  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [article]);

  // "Пункт 1, подпункт 2)" -> the cited point is "Пункт 1"; subpoints are
  // separate chunks with the full string as their point.
  const cited = citation.point;

  return (
    <div className="pb-2">
      <p className="t-eyebrow text-text-3">{t.codes[citation.codeKey]}</p>
      <h2 className="t-title mt-1 pr-10">
        {article ? article.article : t.article(citation.article)}
      </h2>
      {article && <p className="t-caption mt-1 text-text-2">{article.chapter}</p>}
      {lang !== "ru" && article && (
        <p className="t-caption mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface-2 px-3 py-2 text-text-2">
          {!original && article.translated && <span>{t.machineTranslation}</span>}
          <button onClick={() => setOriginal((o) => !o)} className="pressable font-semibold text-accent-ink">
            {original ? t.showTranslation : t.showOriginal}
          </button>
        </p>
      )}

      {error && <p className="t-body mt-4 text-red">{error}</p>}
      {!article && !error && (
        <div className="mt-5 space-y-2.5" aria-label={t.loadingArticle}>
          {[92, 100, 76, 88].map((w, i) => (
            <div key={i} className="h-3.5 animate-pulse rounded-full bg-surface-2" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      {article && (
        <div className="mt-4 space-y-1">
          {article.points.map((p, i) => {
            const isCited = cited !== "" && p.point === cited;
            return (
              <div
                key={i}
                ref={isCited ? highlighted : undefined}
                className={`rounded-xl px-3 py-2 ${isCited ? "bg-gold-soft shadow-[inset_3px_0_0_var(--gold)]" : ""}`}
              >
                {p.point && <p className="t-caption font-semibold text-text-2">{shown === "ru" ? p.point : t.pointTitle(p.point)}</p>}
                <p className="t-body">{p.text}</p>
              </div>
            );
          })}
        </div>
      )}
      <p className="t-caption mt-5 text-text-3">
        {t.officialText}
      </p>
    </div>
  );
}
