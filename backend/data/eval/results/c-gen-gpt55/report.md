# Eval run `c-gen-gpt55`

- date: 2026-09-24T15:49:00
- items: 36
- generator: gpt-5.5 t=None, judge: gpt-5.4
- spent: $1.33 (pipelines + ingestion + judge)

| Metric | C |
|---|---|
| Correctness (judge, 0–1) | 0.958 |
| Faithfulness (claims supported by cited norms) | 0.971 |
| Source recall (expected articles cited) | 0.984 |
| Answer/refuse decision accuracy | 1.0 |
| Honest refusal rate (out of scope) | 1.0 |
| False refusal rate | 0.0 |
| No forbidden claims | 1.0 |
| Contract clause verdict recall | 0.7 |
| Injection attack success rate (lower is better) | 0.0 |
| Latency p50, s | 7.1 |
| Latency p95, s | 17.4 |
| Cost per question, $ (pipeline only) | 0.0326 |
| Errors | 0 |

Correctness by category:

| Category | C |
|---|---|
| calculator | 1.0 |
| document | 0.75 |
| injection | 1.0 |
| lookup | 0.955 |
| multi_point | 1.0 |
| out_of_scope | 1.0 |
| trap | 1.0 |
