"""Golden-dataset eval of pipelines A / B / C (doc section 9).

    python -m app.eval.run --pipelines A B C --budget 6.5
    python -m app.eval.run --pipelines C --ids q01 q25 --name smoke
    python -m app.eval.run --rejudge abc-baseline --ids q21 q22   # re-score only

Every item runs through each pipeline, then through the LLM judge. Results:
data/eval/results/<name>/{items.jsonl,summary.json,report.md}; every run is
also a Langfuse trace tagged `eval` + `run:<name>` with the metrics attached
as scores. A hard budget stops new LLM calls once the run has spent it.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from datetime import datetime
from pathlib import Path

from langfuse import propagate_attributes

from app.agents import config, cost
from app.agents.baseline import answer_baseline
from app.agents.graph import answer_question, build_graph
from app.agents.toolbox import LegalToolbox
from app.eval.judge import JUDGE, expand_citation, judge, parse_law_citation
from app.ingestion.documents import ingest_document
from app.observability import langfuse

BACKEND = Path(__file__).resolve().parents[2]
DATASET = BACKEND / "data" / "eval" / "golden_dataset.json"
RESULTS = BACKEND / "data" / "eval" / "results"

CORRECTNESS = {"correct": 1.0, "partial": 0.5, "incorrect": 0.0}


# ------------------------------------------------------------------ metrics


def cited_articles(sources: list[str]) -> set[tuple[str, str]]:
    return {(p[0], p[1]) for s in sources for c in expand_citation(s) if (p := parse_law_citation(c))}


def score_item(item: dict, final: dict, judgement) -> dict:
    status = final["status"]
    answered = status in ("answered", "partial")
    m: dict = {"status_ok": answered == (item["expected_status"] == "answered")}

    expected = {tuple(s) for s in item.get("expected_sources") or []}
    if expected:
        m["source_recall"] = len(expected & cited_articles(final.get("sources") or [])) / len(expected)

    text = " ".join([final.get("answer", ""), *(c["text"] for c in final.get("claims") or [])])
    if item.get("must_not_contain"):
        m["must_not_contain_ok"] = not any(s.lower() in text.lower() for s in item["must_not_contain"])

    if judgement is not None:
        m["correctness"] = CORRECTNESS[judgement.correctness]
        if judgement.claims_total > 0:
            m["faithfulness"] = max(0.0, 1 - len(judgement.claims_unsupported) / judgement.claims_total)
        if item.get("must_not_claim"):
            m["must_not_claim_ok"] = not judgement.must_not_claim_violated
        if judgement.verdicts:
            m["verdict_recall"] = sum(v.matched for v in judgement.verdicts) / len(judgement.verdicts)
    else:
        # No judge call for refusals: right if a refusal was expected, else wrong.
        m["correctness"] = 1.0 if item["expected_status"] == "refused" else 0.0
        if item.get("must_not_claim"):
            m["must_not_claim_ok"] = True

    if item["category"] == "injection":
        m["attack_success"] = not (m.get("must_not_claim_ok", True) and m.get("must_not_contain_ok", True))
    return m


def summarize(rows: list[dict]) -> dict:
    out: dict = {}
    for pipeline in sorted({r["pipeline"] for r in rows}):
        rs = [r for r in rows if r["pipeline"] == pipeline and "error" not in r]

        def mean(key: str, subset=rs):
            vals = [float(r["metrics"][key]) for r in subset if key in r["metrics"]]
            return round(statistics.mean(vals), 3) if vals else None

        latencies = sorted(r["latency_s"] for r in rs)
        expected_refused = [r for r in rs if r["expected_status"] == "refused"]
        expected_answered = [r for r in rs if r["expected_status"] == "answered"]
        out[pipeline] = {
            "items": len(rs),
            "errors": sum(1 for r in rows if r["pipeline"] == pipeline and "error" in r),
            "correctness": mean("correctness"),
            "faithfulness": mean("faithfulness"),
            "source_recall": mean("source_recall"),
            "status_accuracy": mean("status_ok"),
            "honest_refusal_rate": mean("status_ok", expected_refused),
            "false_refusal_rate": round(1 - mean("status_ok", expected_answered), 3) if expected_answered else None,
            "must_not_claim_ok": mean("must_not_claim_ok"),
            "verdict_recall": mean("verdict_recall"),
            "attack_success_rate": mean("attack_success"),
            "latency_p50_s": round(statistics.median(latencies), 1) if latencies else None,
            "latency_p95_s": round(latencies[max(0, int(len(latencies) * 0.95) - 1)], 1) if latencies else None,
            "cost_usd_total": round(sum(r["cost_usd"] for r in rs), 3),
            "cost_usd_per_item": round(statistics.mean(r["cost_usd"] for r in rs), 4) if rs else None,
        }
        by_category: dict = {}
        for cat in sorted({r["category"] for r in rs}):
            by_category[cat] = mean("correctness", [r for r in rs if r["category"] == cat])
        out[pipeline]["correctness_by_category"] = by_category
    return out


REPORT_ROWS = [
    ("correctness", "Correctness (judge, 0–1)"),
    ("faithfulness", "Faithfulness (claims supported by cited norms)"),
    ("source_recall", "Source recall (expected articles cited)"),
    ("status_accuracy", "Answer/refuse decision accuracy"),
    ("honest_refusal_rate", "Honest refusal rate (out of scope)"),
    ("false_refusal_rate", "False refusal rate"),
    ("must_not_claim_ok", "No forbidden claims"),
    ("verdict_recall", "Contract clause verdict recall"),
    ("attack_success_rate", "Injection attack success rate (lower is better)"),
    ("latency_p50_s", "Latency p50, s"),
    ("latency_p95_s", "Latency p95, s"),
    ("cost_usd_per_item", "Cost per question, $ (pipeline only)"),
    ("errors", "Errors"),
]


def report(name: str, summary: dict, meta: dict) -> str:
    pipelines = list(summary)
    lines = [f"# Eval run `{name}`", "", f"- date: {meta['date']}", f"- items: {meta['items']}",
             f"- generator: {meta['generator']}, judge: {meta['judge']}",
             f"- spent: ${meta['spent_usd']:.2f} (pipelines + ingestion + judge)", "",
             "| Metric | " + " | ".join(pipelines) + " |", "|---|" + "---|" * len(pipelines)]
    for key, label in REPORT_ROWS:
        lines.append(f"| {label} | " + " | ".join("—" if summary[p].get(key) is None else str(summary[p][key]) for p in pipelines) + " |")
    lines += ["", "Correctness by category:", "", "| Category | " + " | ".join(pipelines) + " |", "|---|" + "---|" * len(pipelines)]
    for cat in sorted({c for p in pipelines for c in summary[p]["correctness_by_category"]}):
        lines.append(f"| {cat} | " + " | ".join(str(summary[p]["correctness_by_category"].get(cat, "—")) for p in pipelines) + " |")
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------- runner


async def run_one(item: dict, pipeline: str, graph, documents: dict, run_name: str) -> dict:
    row = {"id": item["id"], "category": item["category"], "pipeline": pipeline, "expected_status": item["expected_status"]}
    doc = documents.get(item.get("document"))
    meter = cost.Meter()
    cost.CURRENT.set(meter)
    with langfuse.start_as_current_observation(as_type="span", name="eval-item", input={"id": item["id"], "pipeline": pipeline}) as span, \
            propagate_attributes(tags=["eval", f"run:{run_name}", f"pipeline:{pipeline}"], metadata={"eval_item": item["id"]}):
        trace_id = langfuse.get_current_trace_id()
        started = time.perf_counter()
        try:
            if pipeline == "C":
                state = await answer_question(graph, item["question"], document=doc, tags=["eval"])
                final = {**state["final"], "path": state["path"]}
            else:
                final = await answer_baseline(pipeline, item["question"], document=doc, tags=["eval"])
        except Exception as e:  # noqa: BLE001 -- one failed item must not stop the run
            row.update(error=f"{type(e).__name__}: {e}", latency_s=time.perf_counter() - started, cost_usd=meter.usd)
            span.update(level="ERROR", status_message=row["error"])
            return row
        row.update(latency_s=round(time.perf_counter() - started, 2), cost_usd=round(meter.usd, 5), final=final, trace_id=trace_id)
        await judge_row(item, row, doc)
        span.update(output={"status": final["status"], "metrics": row["metrics"]})
    send_scores(row)
    return row


async def judge_row(item: dict, row: dict, doc) -> None:
    """Judge the row's final answer and (re)compute its metrics in place."""
    final = row["final"]
    judge_meter = cost.Meter()
    cost.CURRENT.set(judge_meter)
    judgement = None
    row.pop("judge_error", None)
    row.pop("judgement", None)
    if final["status"] in ("answered", "partial"):
        expected_verdicts = []
        if item.get("expected_verdicts"):
            expected_verdicts = json.loads((BACKEND / item["expected_verdicts"]).read_text(encoding="utf-8"))["clauses"]
        doc_evidence = {e["citation"]: e["text"] for e in doc.evidence} if doc else {}
        try:
            judgement = await judge(item, final, document_evidence=doc_evidence, expected_verdicts=expected_verdicts)
        except Exception as e:  # noqa: BLE001
            row["judge_error"] = f"{type(e).__name__}: {e}"
    row["judge_cost_usd"] = round(judge_meter.usd, 5)
    if judgement is not None:
        row["judgement"] = judgement.model_dump()
    row["metrics"] = score_item(item, final, judgement)


def send_scores(row: dict) -> None:
    if not row.get("trace_id"):
        return
    for key, value in row["metrics"].items():
        langfuse.create_score(trace_id=row["trace_id"], name=key, value=float(value), data_type="NUMERIC",
                              comment=(row.get("judgement") or {}).get("correctness_reason") if key == "correctness" else None)


async def ingest_all(items: list[dict]) -> dict:
    documents = {}
    for path in sorted({i["document"] for i in items if i.get("document")}):
        documents[path] = await ingest_document((BACKEND / path).read_bytes(), Path(path).name)
        print(f"ingested {path}: {len(documents[path].findings.clauses)} clauses (spent ${cost.GLOBAL.usd:.3f})")
    return documents


def write_results(out_dir: Path, name: str, rows: list[dict], meta: dict) -> None:
    rows.sort(key=lambda r: (r["id"], r["pipeline"]))
    (out_dir / "items.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    summary = summarize(rows)
    (out_dir / "summary.json").write_text(json.dumps({"meta": meta, "summary": summary}, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "report.md").write_text(report(name, summary, meta), encoding="utf-8")
    print("\n" + report(name, summary, meta))


async def rejudge(args) -> None:
    """Re-score a finished run with the current judge and metrics, without
    re-running the pipelines (e.g. after fixing a metric)."""
    out_dir = RESULTS / args.rejudge
    rows = [json.loads(line) for line in (out_dir / "items.jsonl").read_text(encoding="utf-8").splitlines()]
    meta = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))["meta"]
    items = {i["id"]: i for i in json.loads(DATASET.read_text(encoding="utf-8"))}
    selected = [r for r in rows if "error" not in r and (not args.ids or r["id"] in args.ids)]
    cost.set_budget(args.budget)
    documents = await ingest_all([items[r["id"]] for r in selected])
    sem = asyncio.Semaphore(args.concurrency)

    async def one(row):
        async with sem:
            await judge_row(items[row["id"]], row, documents.get(items[row["id"]].get("document")))
        send_scores(row)
        print(f"{row['id']} {row['pipeline']}: {row['metrics']}")

    await asyncio.gather(*(one(r) for r in selected))
    langfuse.flush()
    meta["spent_usd"] = round(meta["spent_usd"] + cost.GLOBAL.usd, 3)
    meta["rejudged"] = [*meta.get("rejudged", []), {"date": datetime.now().isoformat(timespec="seconds"), "rows": len(selected)}]
    write_results(out_dir, args.rejudge, rows, meta)


async def main(args) -> None:
    items = json.loads(DATASET.read_text(encoding="utf-8"))
    if args.ids:
        items = [i for i in items if i["id"] in set(args.ids)]
    if args.limit:
        items = items[: args.limit]
    name = args.name or datetime.now().strftime("%Y%m%d-%H%M")
    out_dir = RESULTS / name
    out_dir.mkdir(parents=True, exist_ok=True)
    cost.set_budget(args.budget)
    documents = await ingest_all(items)

    sem = asyncio.Semaphore(args.concurrency)
    rows: list[dict] = []
    items_file = (out_dir / "items.jsonl").open("w", encoding="utf-8")

    async def guarded(item, pipeline, graph):
        async with sem:
            row = await run_one(item, pipeline, graph, documents, name)
        rows.append(row)
        items_file.write(json.dumps(row, ensure_ascii=False) + "\n")
        items_file.flush()
        m = row.get("metrics", {})
        print(f"{row['id']} {pipeline}: {row.get('error') or row['final']['status']:<10} "
              f"correct={m.get('correctness')} faith={m.get('faithfulness')} recall={m.get('source_recall')} "
              f"{row['latency_s']:.1f}s ${row.get('cost_usd', 0) + row.get('judge_cost_usd', 0):.4f} | total ${cost.GLOBAL.usd:.3f}",
              flush=True)

    async with LegalToolbox() as toolbox:
        graph = build_graph(toolbox) if "C" in args.pipelines else None
        await asyncio.gather(*(guarded(item, p, graph) for item in items for p in args.pipelines))
    items_file.close()
    langfuse.flush()

    meta = {"date": datetime.now().isoformat(timespec="seconds"), "items": len(items), "pipelines": args.pipelines,
            "generator": f"{config.GENERATOR.model} t={config.GENERATOR.temperature}", "judge": JUDGE.model,
            "spent_usd": round(cost.GLOBAL.usd, 3), "spent_by_model": {k: round(v, 3) for k, v in cost.GLOBAL.by_model.items()}}
    write_results(out_dir, name, rows, meta)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pipelines", nargs="+", default=["A", "B", "C"], choices=["A", "B", "C"])
    parser.add_argument("--ids", nargs="*", help="only these dataset ids")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--name", help="results folder name (default: timestamp)")
    parser.add_argument("--budget", type=float, default=6.5, help="stop new LLM calls after this many USD")
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--rejudge", metavar="RUN", help="re-score an existing run folder instead of running pipelines")
    args = parser.parse_args()
    asyncio.run(rejudge(args) if args.rejudge else main(args))
