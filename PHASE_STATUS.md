# Phase status (verified 12 Oct 2026, 11:00)

| Phase | Scope | State | Commit |
|---|---|---|---|
| 1 | Inspect materials, plan, documentation | Done | — |
| 2 | `package.json`, `validate.js`, `check.js`, brute-force oracle `tools/brute.js`, tests | Done | `35fb8a1`, `82ff9ab` |
| 3 | `solve.js` exact search. The planned branch and bound was replaced by a layered dynamic programme over dark-run states (see `ARCHITECTURE.md`) | Done | `35fb8a1`, fix `409a00e` |
| 4 | `explain.js` reasons; `diagnose.js` infeasibility with numbers and a labelled best-effort roster | Done (the swap-based "which shop took the diesel" reason was not built; see `KNOWN_ISSUES.md` #6) | `35fb8a1`, `41cf264` |
| 5 | `server.js` `POST /api/roster` (200 / 400), static screen, 1 MB body limit, CLI | Done. The output format is provisional: there is no `schema.md` and the validator was not run | `82ff9ab` |
| 6 | Screen: upload or paste, board, hourly load and diesel with running total, reasons (hover, click and list), status and totals, dark hours, download, one-page A4 print | Done | `41cf264` |
| 7 | `outputs/sample_output.json`; `evidence/` (real crash, its fix, boundary pair), all through the API | Done for the sample and evidence. **`outputs/minute150_output.json` waits for the official minute-150 input** | `b56ab7f`, `409a00e`, `510abc9` |
| 8 | Docs describe the real state; clean start check; package | Done in this commit (clean check results below) | — |

## Tests actually run

**`npm test`:** 32 tests, 32 pass, 0 fail, 0 skipped, about 8 s (Node 22.22.0).

**Submission audit (12 Oct 2026, about 11:20-11:45):**

- Added `tests/audit.test.js` (7 tests):
  - fuel thresholds: exactly at a level, between levels, zero load;
  - one lookup on the combined load;
  - capacity exactly full vs 1 kW over;
  - a dark run reaching the limit, a grid hour resetting it, and the same shop infeasible without the reset (brute force agrees);
  - more broken-roster mutants: duplicate, unknown id, missing shop, wrong `dark_hours`, slot twice, grid hour listed;
  - 13 more invalid inputs;
  - one server answering mixed requests with byte-identical repeats.
- The audit tests passed against the existing solver: they found no defect there.
- A seeded random stress test (`tools/fuzz.js`) **found a real defect**: a feasible day was answered "infeasible, not proven" after 21 s. Captured in `evidence/regression_timeout/` and fixed in `a907b84`.
- After the fix, `node tools/fuzz.js 777 150` and `node tools/fuzz.js 20261012 150` answered all 300 inputs within 6.7 s. 299 answers were proven; 1 is labelled not proven.

| File | Tests |
|---|---|
| `tests/solver.test.js` (8) | worked example 84 / 8.00 L; sample 186, checker-clean, under 10 s, reasons contain numbers; same input gives the same output; sample with a 16:00 outage is infeasible (needs 17.60 L) with a best-effort roster; no outages; no shops; **300 random small markets give the same value and the same feasibility as the brute-force oracle**; every reason's dark-streak and spare-diesel figures match an independent recount from the roster |
| `tests/check_validate.test.js` (5) | the brief's published worked-example roster passes the checker; 8 broken copies and a 7.99 L budget are caught; 14 invalid inputs each name the right field; valid edge cases are accepted |
| `tests/audit.test.js` (7) | see the audit note above |
| `tests/api.test.js` (12, including the fuzz case 77 regression) | through HTTP: sample; non-JSON gives 400; budget boundary 17.60 ok / 17.59 infeasible; mandatory over capacity; mandatory-only diesel over budget; oversized shop in long vs short outage blocks; K = 0; K = 10; the regression input; adversarial 400s; 405 and 404 |

**Manual checks:**

- `node src/cli.js` exits 0 on the sample and 1 on `{`.
- `sh outputs/make.sh` and `sh evidence/run.sh` reproduce the committed files exactly (`git diff` is clean).
- **Screen redesign (`DESIGN_SYSTEM.md`):** checked against the real API with headless Chromium (Playwright, from a scratch script that is not in the repository). **22 of 22 checks passed:**
  - idle state shown before any result;
  - sample: metrics match the API (186; 16.40 / 17.00 L; peak 20 / 20 kW);
  - board cells match the API (41 powered, 43 dark); 36 grid cells; one chart bar per outage hour; every ✗ has a reason letter;
  - Enter on a focused ✗ selects its reason; the capacity filter shows only capacity reasons;
  - the downloaded JSON equals the API response; print to A4 PDF is 1 page;
  - editing the input shows the stale-result note, and Compute makes a new API call and clears it;
  - the loading state is shown while the request runs;
  - an infeasible input shows the best-effort banner and never "OK";
  - invalid input names the field and shows no board;
  - a failed request shows Try again, and retrying recovers;
  - no page-wide sideways scroll at 390 px;
  - only localhost requests;
  - no console errors apart from the expected 400 and the deliberately aborted request.

  Light, dark, infeasible, print and 390 px screenshots were reviewed by eye.
- Earlier screen version, same method:
  - the sample shows OK, 186 and 16.40 / 17.00 L;
  - clicking a ✗ shows its reason;
  - download gives the same JSON;
  - invalid input shows the field;
  - print to A4 PDF is **1 page**.

**Measured times:** see `ARCHITECTURE.md`. The sample takes about 0.6 s; the hardest synthetic input measured took about 5.3 s.

## Still to do

1. **When the minute-150 input arrives:**
   1. save it unchanged as `inputs/minute150_input.json`;
   2. with the server running, run `sh outputs/make.sh`;
   3. check the result on the screen;
   4. commit `outputs/minute150_output.json`.
2. If `schema.md` or the validator is supplied: align `serialize.js`, run the validator, and record the result here.
