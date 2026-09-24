"""
Ask pipeline C (agentic RAG) from the terminal.

    python scripts/ask.py "Сколько дней отпуска мне положено?"
    python scripts/ask.py --doc data/test_docs/contract_scan.jpg
    python scripts/ask.py --doc contract.pdf "Законен ли испытательный срок?"
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.graph import answer_question, build_graph  # noqa: E402
from app.agents.toolbox import LegalToolbox  # noqa: E402
from app.ingestion.documents import ingest_document  # noqa: E402
from app.observability import langfuse  # noqa: E402

DEFAULT_REVIEW_QUESTION = "Проверь мой трудовой договор на соответствие Трудовому кодексу РК."


async def main(questions: list[str], doc_path: str | None) -> None:
    document = None
    if doc_path:
        t0 = time.perf_counter()
        document = await ingest_document(Path(doc_path).read_bytes(), Path(doc_path).name)
        methods = ", ".join(f"стр. {p.page}: {p.method}" for p in document.pages)
        print(f"document {document.id}: {len(document.findings.clauses)} пунктов ({methods}), ПДн: {document.pii_found} | {time.perf_counter() - t0:.1f}s")
        questions = questions or [DEFAULT_REVIEW_QUESTION]
    async with LegalToolbox() as toolbox:
        graph = build_graph(toolbox)
        for q in questions or ["Сколько дней основного оплачиваемого отпуска положено работнику?"]:
            t0 = time.perf_counter()
            state = await answer_question(graph, q, document=document, tags=["cli"])
            final = state["final"]
            print(f"\n=== {q}")
            print(f"path: {' -> '.join(state['path'])} | {time.perf_counter() - t0:.1f}s")
            print(f"status: {final['status']}")
            for c in final["claims"]:
                print(f"  • {c['text']}")
                print(f"      [{'; '.join(c['sources'])}]")
            if final["removed_claims"]:
                print(f"  removed (unverified): {final['removed_claims']}")
            if final["missing_info"]:
                print(f"  missing: {final['missing_info']}")
            if final["status"] == "refused":
                print(f"  {final['answer']}")
    langfuse.flush()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("questions", nargs="*")
    parser.add_argument("--doc", help="PDF/JPEG/PNG to check against the Labor Code")
    args = parser.parse_args()
    asyncio.run(main(args.questions, args.doc))
