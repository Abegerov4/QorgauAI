"use client";

import { useEffect, useRef, useState } from "react";
import { api, type ArticleResponse, type Clause } from "@/lib/api";
import type { Citation } from "@/lib/citations";
import { TOPIC_LABELS } from "@/lib/labels";

type Props = { citation: Citation; clauses: Clause[] };

export function CitationView({ citation, clauses }: Props) {
  if (citation.kind === "doc") {
    const clause = clauses.find((c) => c.clause_number === citation.clause);
    return (
      <div className="pb-2">
        <p className="t-eyebrow text-text-3">Ваш договор</p>
        <h2 className="t-title mt-1 pr-10">Пункт {citation.clause}</h2>
        {clause ? (
          <>
            <p className="t-caption mt-1 text-text-2">{TOPIC_LABELS[clause.topic] ?? clause.topic}</p>
            <p className="t-body mt-4 whitespace-pre-line">{clause.text}</p>
          </>
        ) : (
          <p className="t-body mt-4 text-text-2">Текст пункта недоступен: документ был загружен в другой сессии.</p>
        )}
      </div>
    );
  }
  if (citation.kind === "tool") {
    return (
      <div className="pb-2">
        <p className="t-eyebrow text-text-3">Инструмент</p>
        <h2 className="t-title mt-1 pr-10">Калькулятор отпуска</h2>
        <p className="t-body mt-4 text-text-2">{citation.raw}</p>
      </div>
    );
  }
  return <ArticleView citation={citation} />;
}

function ArticleView({ citation }: { citation: Extract<Citation, { kind: "law" }> }) {
  const [article, setArticle] = useState<ArticleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const highlighted = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .article(citation.codeKey, citation.article)
      .then((a) => alive && setArticle(a))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [citation.codeKey, citation.article]);

  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [article]);

  // "Пункт 1, подпункт 2)" -> the cited point is "Пункт 1"; subpoints are
  // separate chunks with the full string as their point.
  const cited = citation.point;

  return (
    <div className="pb-2">
      <p className="t-eyebrow text-text-3">{citation.codeShort}</p>
      <h2 className="t-title mt-1 pr-10">
        {article ? article.article : `Статья ${citation.article}`}
      </h2>
      {article && <p className="t-caption mt-1 text-text-2">{article.chapter}</p>}

      {error && <p className="t-body mt-4 text-red">{error}</p>}
      {!article && !error && (
        <div className="mt-5 space-y-2.5" aria-label="Загрузка статьи">
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
                className={`rounded-xl px-3 py-2 ${isCited ? "bg-accent-soft" : ""}`}
              >
                {p.point && <p className="t-caption font-semibold text-text-2">{p.point}</p>}
                <p className="t-body">{p.text}</p>
              </div>
            );
          })}
        </div>
      )}
      <p className="t-caption mt-5 text-text-3">
        Текст из официальной редакции, загруженной в базу QorgauAI. Актуальную редакцию проверяйте на adilet.zan.kz.
      </p>
    </div>
  );
}
