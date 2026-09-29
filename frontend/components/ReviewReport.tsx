"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ContractReview, ReviewRow, ReviewVerdict } from "@/lib/api";
import { citationLabel, parseCitation } from "@/lib/citations";
import { plural } from "@/lib/labels";

// The printable report of a contract review. It is mounted only while
// printing, straight under <body>, and the print stylesheet (.rr in
// globals.css) hides everything else, so "Save as PDF" in the print dialog
// gives a clean, always-light document with the colours of the verdicts.

const SECTIONS: { verdict: ReviewVerdict; title: string; label: string }[] = [
  { verdict: "violation", title: "Нарушения", label: "Нарушение" },
  { verdict: "disputed", title: "Спорные пункты", label: "Спорно" },
];

export function ReviewReport({ review, onDone }: { review: ContractReview; onDone: () => void }) {
  useEffect(() => {
    const title = document.title;
    document.title = `Проверка договора — ${review.filename.replace(/\.[^.]+$/, "")}`; // the PDF's file name
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.title = title;
      onDone();
    };
    window.addEventListener("afterprint", finish, { once: true });
    // Let the portal paint before the dialog opens.
    const t = setTimeout(() => {
      window.print();
      setTimeout(finish, 500); // browsers without afterprint
    }, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", finish);
      document.title = title;
    };
  }, [review, onDone]);

  const c = review.counts;
  const total = review.clauses.length;
  const ok = review.clauses.filter((r) => r.verdict === "ok");
  const unchecked = review.clauses.filter((r) => r.verdict === "unchecked");
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  return createPortal(
    <div className="rr" aria-hidden>
      <header className="rr-head">
        <p className="rr-brand">QorgauAI · проверка трудового договора</p>
        <h1>{review.filename}</h1>
        <p className="rr-muted">
          {date} · {total} {plural(total, "пункт", "пункта", "пунктов")} проверено по Трудовому кодексу и Конституции РК
        </p>
      </header>

      <div className="rr-counts">
        <Count n={c.violation} label={plural(c.violation, "нарушение", "нарушения", "нарушений")} tone="red" />
        <Count n={c.disputed} label={plural(c.disputed, "спорный", "спорных", "спорных")} tone="gold" />
        <Count n={c.ok} label="без нарушений" tone="green" />
        {c.unchecked > 0 && <Count n={c.unchecked} label="не проверено" tone="grey" />}
      </div>
      <div className="rr-bar">
        {(["violation", "disputed", "ok", "unchecked"] as const).map((v) =>
          c[v] ? <span key={v} className={`rr-bar-${v}`} style={{ flexGrow: c[v] }} /> : null,
        )}
      </div>

      {SECTIONS.map(({ verdict, title, label }) => {
        const rows = review.clauses.filter((r) => r.verdict === verdict);
        if (!rows.length) return null;
        return (
          <section key={verdict}>
            <h2>
              {title} <span className="rr-muted">{rows.length}</span>
            </h2>
            {rows.map((r) => (
              <Item key={r.clause_number} row={r} label={label} />
            ))}
          </section>
        );
      })}

      {ok.length > 0 && (
        <section>
          <h2>
            Без нарушений <span className="rr-muted">{ok.length}</span>
          </h2>
          <p className="rr-muted rr-note">Противоречий найденным нормам не обнаружено.</p>
          <table className="rr-ok">
            <tbody>
              {ok.map((r) => (
                <tr key={r.clause_number}>
                  <td className="rr-num">{r.clause_number}</td>
                  <td>{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {unchecked.length > 0 && (
        <section>
          <h2>Не проверены</h2>
          <p className="rr-note">Пункты {unchecked.map((r) => r.clause_number).join(", ")}: проверьте их с юристом.</p>
        </section>
      )}

      <footer className="rr-foot">
        {review.truncated && <p>Проверены первые {total} пунктов: договор длиннее.</p>}
        <p>{review.disclaimer}</p>
        <p>Отчёт подготовлен QorgauAI · qorgau-ai.up.railway.app</p>
      </footer>
    </div>,
    document.body,
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`rr-count rr-${tone}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function Item({ row, label }: { row: ReviewRow; label: string }) {
  return (
    <article className={`rr-item rr-item-${row.verdict}`}>
      <p className="rr-item-head">
        <span className="rr-num">Пункт {row.clause_number}</span>
        <span className="rr-tag">{label}</span>
      </p>
      <blockquote>«{row.text}»</blockquote>
      <p>
        <b>Почему. </b>
        {row.explanation}
      </p>
      {row.verified === false && <p className="rr-muted">Второй агент не подтвердил этот вывод — проверьте его с юристом.</p>}
      {row.norms.length > 0 && (
        <div className="rr-norms">
          {row.norms.map((n) => (
            <p key={n.citation}>
              <b>{citationLabel(parseCitation(n.citation))}.</b> {n.text}
            </p>
          ))}
        </div>
      )}
      {row.fix && (
        <div className="rr-fix">
          <b>Как исправить: </b>«{row.fix}»
        </div>
      )}
    </article>
  );
}
