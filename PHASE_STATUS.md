# Phase status

| Phase | Scope | Estimate | State |
|---|---|---|---|
| 1 | Inspect materials, plan, documentation | 20 min | **Done** (this commit) |
| 2 | Project skeleton (`package.json`, `npm start`); `validate.js` with every `invalid_input` rule; `check.js` rule checker; brute-force oracle `tools/brute.mjs`; unit tests for both | 35 min | Not started |
| 3 | `solve.js`: pre-checks, incumbent, branch and bound with suffix-knapsack bound and memo, time guard. **First:** performance test on a synthetic worst case. Tests: worked example = 84 / 8.00 L; randomized oracle comparison; sample input stays under 10 s | 60 min | Not started |
| 4 | `explain.js` (capacity / fuel / fixed / zero-value / swap reasons) and `diagnose.js` (infeasible conflicts plus a labelled best-effort roster); tests for each infeasible category | 30 min | Not started |
| 5 | `server.js`: `POST /api/roster` (200 for ok/infeasible, 400 for invalid_input), static files, body-size limit; output format aligned to `schema.md` (**needs the pack**); run the official validator if supplied | 20 min | Not started |
| 6 | Screen: load (upload or paste), roster board, per-hour load/fuel/running total, reasons on ✗ (hover, plus a list), status and totals, per-shop dark hours, download output, one-page A4 print CSS | 45 min | Not started |
| 7 | **Minute-150 checkpoint:** rerun on the updated input; commit `outputs/sample_output.json` and `outputs/minute150_output.json`; build `evidence/` (breaking input with old and fixed output; boundary input with output; all via the API with `curl`) | 20 min | Not started |
| 8 | README final pass ("find the decision logic in under 2 minutes"), clean start test, ZIP or repository link | 15 min | Not started |

**Total after Phase 1:** about 3 h 45 min of work. In the brief's 3.5-hour format, that means:

- Phase 4's swap reasons and the best-effort infeasible roster are the first things to trim.
- Phases 2, 3 and 5 are the critical path, because they cover correctness and value served.
- Phases 6 and 7 must not be skipped, because they cover working-app and evidence marks.

## Tests actually run so far

- **Brute-force spike** (scratch script, not yet in the repository) on the transcribed worked example.
  - Result: 201,105 feasible rosters, best value **84**, fuel **8.00 L**. This matches the brief.
  - Runtime: about 11.5 s.
- **Arithmetic check of `inputs/sample_input.json`:**
  - 7 outage hours (slots 2-5 and 7-9);
  - mandatory load 5 kW; all shops together 38 kW against a capacity of 20;
  - mandatory-only diesel 8.40 L; full load every outage hour would need 19.60 L; budget 17.00 L, so diesel is a binding constraint.

No application code exists yet, so no application tests have been run.
