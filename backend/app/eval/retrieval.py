"""Retrieval-only eval on the golden dataset: no LLM calls, only query
embeddings (fractions of a cent per run), so CI can run it on every push.

    python -m app.eval.retrieval                   # dense and hybrid, print table
    python -m app.eval.retrieval --min-recall 0.85 # exit 1 if hybrid Recall@5 is lower

Questions about an uploaded contract are skipped: their text ("check my
contract") is not a search query; retrieval for them depends on the clauses.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from pathlib import Path

from app.eval.judge import CODE_KEYS
from app.retrieval.search import dense_only_search, hybrid_search

BACKEND = Path(__file__).resolve().parents[2]
DATASET = BACKEND / "data" / "eval" / "golden_dataset.json"
TOP_K = 5

# Chunks that should never take a top-5 slot: repealed provisions and
# fragments too short to carry a norm on their own.
REPEALED = re.compile(r"^\s*(исключен|утратил)", re.IGNORECASE)
SHORT_CHARS = 40

# Short keyword queries, the way people type into a search box. No expected
# answer: they only measure how much of the top-5 is noise.
KEYWORD_PROBES = [
    "отпуск 24 дня", "испытательный срок", "сверхурочная работа оплата", "заработная плата сроки выплаты",
    "увольнение по инициативе работодателя", "отпуск без сохранения заработной платы", "рабочее время 40 часов",
    "Курултай", "права человека", "минимальная заработная плата", "принципы трудового законодательства",
    "дополнительный отпуск инвалидам",
]


def is_noise(text: str) -> bool:
    return bool(REPEALED.match(text)) or len(text) < SHORT_CHARS


def code_key(code_name: str) -> str:
    return next(key for prefix, key in CODE_KEYS.items() if code_name.startswith(prefix))


def evaluate(search) -> dict:
    items = [i for i in json.loads(DATASET.read_text(encoding="utf-8")) if i.get("expected_sources") and not i.get("document")]
    recalls, rr, noise, misses = [], [], [], []
    for item in items:
        expected = {tuple(s) for s in item["expected_sources"]}
        results = search(item["question"], top_k=TOP_K)
        found = [(code_key(r.code), r.article_number) for r in results]
        recalls.append(len(expected & set(found)) / len(expected))
        rank = next((i for i, f in enumerate(found, 1) if f in expected), None)
        rr.append(1 / rank if rank else 0.0)
        noise.append(sum(is_noise(r.text) for r in results) / len(results))
        if recalls[-1] < 1:
            misses.append({"id": item["id"], "expected": sorted(expected), "found": found})
    probe_noise = [sum(is_noise(r.text) for r in search(q, top_k=TOP_K)) / TOP_K for q in KEYWORD_PROBES]
    return {
        "questions": len(items),
        "recall_at_5": round(statistics.mean(recalls), 3),
        "mrr": round(statistics.mean(rr), 3),
        "noise_at_5": round(statistics.mean(noise), 3),
        "keyword_noise_at_5": round(statistics.mean(probe_noise), 3),
        "misses": misses,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-recall", type=float, help="fail if hybrid Recall@5 is below this")
    parser.add_argument("--out", type=Path, help="write the full result as JSON")
    args = parser.parse_args()

    results = {"dense": evaluate(dense_only_search), "hybrid": evaluate(hybrid_search)}
    print(f"{'':8} {'Recall@5':>9} {'MRR':>6} {'Noise@5':>8} {'KeywordNoise@5':>15}   "
          f"({results['hybrid']['questions']} questions, {len(KEYWORD_PROBES)} keyword probes)")
    for name, r in results.items():
        print(f"{name:8} {r['recall_at_5']:>9} {r['mrr']:>6} {r['noise_at_5']:>8} {r['keyword_noise_at_5']:>15}")
    for m in results["hybrid"]["misses"]:
        print(f"  hybrid miss {m['id']}: expected {m['expected']}, top-5 {m['found']}")
    if args.out:
        args.out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.min_recall is not None and results["hybrid"]["recall_at_5"] < args.min_recall:
        print(f"FAIL: hybrid Recall@5 {results['hybrid']['recall_at_5']} < {args.min_recall}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
