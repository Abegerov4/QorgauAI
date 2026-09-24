"""
Print the latest trace with a given root-observation name as a tree, straight
from the Langfuse v4 observations API (the v3 /api/public/traces endpoint is
gone in v4's events_only mode). Also checks that no raw PII leaked.

    python scripts/inspect_trace.py search-request
    python scripts/inspect_trace.py search_legal_corpus --pii 900101300123
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

FIELDS = "basic,io,model,usage,metrics,trace_context"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root_name", help="name of the root observation, e.g. search-request")
    parser.add_argument("--pii", action="append", default=[], help="raw strings that must NOT appear in the trace")
    args = parser.parse_args()

    auth = (os.environ["LANGFUSE_PUBLIC_KEY"], os.environ["LANGFUSE_SECRET_KEY"])
    url = os.environ["LANGFUSE_BASE_URL"] + "/api/public/v2/observations"

    roots = httpx.get(
        url, params={"name": args.root_name, "isRootObservation": "true", "limit": 1, "fields": FIELDS}, auth=auth
    ).json()["data"]
    if not roots:
        print(f"no trace with root '{args.root_name}' yet")
        return
    root = roots[0]
    obs = httpx.get(url, params={"traceId": root["traceId"], "limit": 200, "fields": FIELDS}, auth=auth).json()["data"]
    obs.sort(key=lambda o: o["startTime"])
    by_id = {o["id"]: o for o in obs}

    def depth(o: dict) -> int:
        d = 0
        while o.get("parentObservationId") in by_id:
            o = by_id[o["parentObservationId"]]
            d += 1
        return d

    total_cost = sum(o.get("totalCost") or 0 for o in obs)
    print(f"trace {root.get('traceName')} | id {root['traceId']} | env {root.get('environment')} | tags {root.get('tags')}")
    print(f"observations {len(obs)} | cost ${total_cost:.6f} | latency {root.get('latency')}s")
    base = os.environ["LANGFUSE_BASE_URL"].rstrip("/")
    project_id = httpx.get(f"{base}/api/public/projects", auth=auth).json()["data"][0]["id"]
    print(f"link {base}/project/{project_id}/traces/{root['traceId']}")
    for o in obs:
        ind = "  " * depth(o)
        print(f"{ind}- {o['name']} [{o['type']}] model={o.get('model')} usage={o.get('usageDetails')} latency={o.get('latency')}")
        print(f"{ind}    in : {str(o.get('input'))[:160]}")
        print(f"{ind}    out: {str(o.get('output'))[:160]}")

    raw = json.dumps(obs, ensure_ascii=False)
    for s in args.pii:
        print(f"PII '{s[:4]}…' leaked: {s in raw}")


if __name__ == "__main__":
    main()
