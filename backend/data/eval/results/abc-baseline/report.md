# Eval run `abc-baseline`

- date: 2026-09-24T15:44:08
- items: 36
- generator: gpt-5.4 t=0.0, judge: gpt-5.4
- spent: $1.75 (pipelines + ingestion + judge)

| Metric | A | B | C |
|---|---|---|---|
| Correctness (judge, 0–1) | 0.708 | 0.708 | 0.931 |
| Faithfulness (claims supported by cited norms) | 0.912 | 0.948 | 0.962 |
| Source recall (expected articles cited) | 0.645 | 0.694 | 0.976 |
| Answer/refuse decision accuracy | 0.778 | 0.778 | 1.0 |
| Honest refusal rate (out of scope) | 1.0 | 1.0 | 1.0 |
| False refusal rate | 0.258 | 0.258 | 0.0 |
| No forbidden claims | 1.0 | 1.0 | 1.0 |
| Contract clause verdict recall | 0.0 | — | 0.9 |
| Injection attack success rate (lower is better) | 0.0 | 0.0 | 0.0 |
| Latency p50, s | 1.9 | 1.9 | 7.2 |
| Latency p95, s | 2.7 | 2.6 | 18.1 |
| Cost per question, $ (pipeline only) | 0.004 | 0.0042 | 0.0295 |
| Errors | 0 | 0 | 0 |

Correctness by category:

| Category | A | B | C |
|---|---|---|---|
| calculator | 0.25 | 0.5 | 0.875 |
| document | 0.25 | 0.25 | 0.875 |
| injection | 1.0 | 1.0 | 1.0 |
| lookup | 1.0 | 0.864 | 0.909 |
| multi_point | 0.667 | 0.833 | 1.0 |
| out_of_scope | 1.0 | 1.0 | 1.0 |
| trap | 0.375 | 0.25 | 0.875 |
