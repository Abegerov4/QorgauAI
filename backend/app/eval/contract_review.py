"""Eval of the colour-coded contract review on synthetic contracts with an
answer key (data/eval/contracts/*.json). Costs money: each contract is read
(the extractor) and reviewed (reviewer + verifier), about $0.05-0.10 each.

    python -m app.eval.contract_review                    # every contract, its .docx
    python -m app.eval.contract_review --format pdf       # the same through the PDF path
    python -m app.eval.contract_review --only v2_gross

Metrics, over all contracts:
- violation recall (red): planted violations the review coloured red;
- violation recall (flagged): coloured red or yellow;
- false red: lawful clauses coloured red (the costliest mistake);
- trap false alarms: suspicious-but-lawful clauses coloured red or yellow;
- red with a norm: red clauses that cite a norm (1.0 by construction).
Clauses are matched by number; a planted clause the extractor lost counts as missed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.agents.cost import CURRENT, Meter
from app.agents.review import review_document
from app.ingestion.documents import ingest_document

BACKEND = Path(__file__).resolve().parents[2]
CONTRACTS = BACKEND / "data" / "eval" / "contracts"
OUT = BACKEND / "data" / "eval" / "results" / "contract_review.json"


async def run_one(key: dict, fmt: str) -> dict:
    path = CONTRACTS / f"{key['id']}.{fmt}"
    meter = Meter()
    CURRENT.set(meter)
    doc = await ingest_document(path.read_bytes(), path.name)
    review = await review_document(doc, session_id="eval-contract-review")
    got = {r["clause_number"]: r for r in review["clauses"]}
    rows = []
    for k in key["clauses"]:
        r = got.get(k["clause"])
        rows.append({
            "clause": k["clause"],
            "expected": k["verdict"],
            "trap": k["trap"],
            "got": r["verdict"] if r else "missing",
            "norms": [n["citation"] for n in r["norms"]] if r else [],
            "explanation": r["explanation"] if r else None,
        })
    return {"id": key["id"], "file": path.name, "cost_usd": round(meter.usd, 4), "counts": review["counts"], "clauses": rows}


def score(results: list[dict]) -> dict:
    rows = [r for res in results for r in res["clauses"]]
    planted = [r for r in rows if r["expected"] == "violation"]
    lawful = [r for r in rows if r["expected"] == "ok"]
    traps = [r for r in rows if r["trap"]]
    red = [r for res in results for r in res["clauses"] if r["got"] == "violation"]

    def share(part, whole):
        return round(len(part) / len(whole), 3) if whole else None

    return {
        "violation_recall_red": share([r for r in planted if r["got"] == "violation"], planted),
        "violation_recall_flagged": share([r for r in planted if r["got"] in ("violation", "disputed")], planted),
        "false_red": len([r for r in lawful if r["got"] == "violation"]),
        "false_red_rate": share([r for r in lawful if r["got"] == "violation"], lawful),
        "trap_false_alarms": len([r for r in traps if r["got"] in ("violation", "disputed")]),
        "red_with_norm": share([r for r in red if r["norms"]], red),
        "missing_clauses": len([r for r in rows if r["got"] == "missing"]),
        "planted": len(planted),
        "lawful": len(lawful),
        "traps": len(traps),
        "cost_usd": round(sum(r["cost_usd"] for r in results), 4),
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--format", choices=["docx", "pdf"], default="docx")
    parser.add_argument("--only", help="one contract id, e.g. v2_gross")
    args = parser.parse_args()

    keys = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(CONTRACTS.glob("*.json"))]
    keys = [k for k in keys if not args.only or k["id"] == args.only]
    results = [await run_one(k, args.format) for k in keys]
    summary = score(results)

    for res in results:
        wrong = [r for r in res["clauses"] if r["got"] != r["expected"]]
        print(f"\n{res['file']}  ${res['cost_usd']}  {res['counts']}")
        for r in wrong:
            mark = "ЛОВУШКА " if r["trap"] else ""
            print(f"  {mark}{r['clause']}: ожидали {r['expected']}, получили {r['got']} — {r['explanation']}")
    print("\n" + json.dumps(summary, ensure_ascii=False, indent=2))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"format": args.format, "summary": summary, "results": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nСохранено: {OUT.relative_to(BACKEND)}")


if __name__ == "__main__":
    asyncio.run(main())
