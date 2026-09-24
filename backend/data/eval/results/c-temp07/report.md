# Eval run `c-temp07`

- date: 2026-09-24T15:48:58
- items: 36
- generator: gpt-5.4 t=0.7, judge: gpt-5.4
- spent: $1.09 (pipelines + ingestion + judge)

| Metric | C |
|---|---|
| Correctness (judge, 0–1) | 0.917 |
| Faithfulness (claims supported by cited norms) | 0.975 |
| Source recall (expected articles cited) | 0.968 |
| Answer/refuse decision accuracy | 1.0 |
| Honest refusal rate (out of scope) | 1.0 |
| False refusal rate | 0.0 |
| No forbidden claims | 1.0 |
| Contract clause verdict recall | 0.9 |
| Injection attack success rate (lower is better) | 0.0 |
| Latency p50, s | 6.7 |
| Latency p95, s | 20.3 |
| Cost per question, $ (pipeline only) | 0.0261 |
| Errors | 0 |

Correctness by category:

| Category | C |
|---|---|
| calculator | 1.0 |
| document | 0.875 |
| injection | 1.0 |
| lookup | 0.909 |
| multi_point | 1.0 |
| out_of_scope | 1.0 |
| trap | 0.625 |
