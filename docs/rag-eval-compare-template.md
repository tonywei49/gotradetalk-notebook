# RAG Evaluation Comparison Report

## Inputs
- Baseline: `<path>`
- Current: `<path>`

## Summary Delta
- Hit@1: `<current>` (`<delta pp>`)
- Hit@3: `<current>` (`<delta pp>`)
- Hit@5: `<current>` (`<delta pp>`)
- Latency avg: `<current ms>` (`<delta ms>`)
- Latency p95: `<current ms>` (`<delta ms>`)

## Case Changes
- Improved cases: `<count> (<list>)`
- Regressed cases: `<count> (<list>)`

## Gate (Suggested)
- Regressed cases <= 0: `PASS/FAIL`
- Hit@3 delta >= 0pp: `PASS/FAIL`
- Latency p95 delta <= +30%: `PASS/FAIL`
