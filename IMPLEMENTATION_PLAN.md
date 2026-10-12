# Who Stays On? Implementation plan (version 2)

**Status:** proposed, awaiting approval. Nothing below is implemented.

**Version 2 (10:40)** replaces version 1 (10:30). Changes:

- tasks now have at most 3 acceptance criteria and are XS/S/M only, so the solver is split into T3a and T3b;
- an early vertical slice (T5) is added;
- schedule checkpoints are re-timed to the actual clock;
- research findings are folded in: the run-vector dominance rule, and reasons being complete only for proven-optimal rosters.

Companion documents:

- `IDEA_TO_ACTION.md`: strategy, MVP, judging matrix, risks, pitch and specification.
- `ARCHITECTURE.md`, `KNOWN_ISSUES.md`: Phase 1, to be updated in T17.

Repository facts (inspected 10:35):

- `/home/claude/who-stays-on/` contains the Phase 1 docs, `inputs/sample_input.json` and `tests/fixtures/worked_example_input.json`.
- **No code, no `package.json`, no git.**
- Node v22.22.0. Zero npm dependencies by design.

All commands below use files **created by the tasks themselves**; none exist yet.

---

## 1. Provisional API contract

This is fixed now so the screen can be built in parallel. Field names are replaced by `schema.md` the moment it arrives (only `src/solver/serialize.js` changes).

**`ok`** (HTTP 200):

```json
{
  "status": "ok",
  "roster": [
    { "slot": 2, "time": "12:00",
      "powered": ["pharmacy", "atm_booth", "tea_stall"],
      "dark": [ { "id": "tailor_jamal", "reason": "Capacity: +4 kW would make 22 of 20 kW." } ],
      "load_kw": 18, "fuel_litres": 2.80, "fuel_running_litres": 2.80 }
  ],
  "value_total": 186,
  "fuel_total_litres": 16.80,
  "dark_hours": { "pharmacy": 0, "tailor_jamal": 3 },
  "capacity_kw": 20, "fuel_budget_litres": 17.00,
  "optimal": true
}
```

**`infeasible`** (HTTP 200):

```json
{ "status": "infeasible",
  "conflicts": [ { "rule": "fuel", "shops": [], "slots": [2,3,4,5,6,7,8,9],
                   "detail": "Keeping every shop within 2 dark hours needs at least 17.60 L; budget is 17.00 L." } ],
  "best_effort": null }
```

**`invalid_input`** (HTTP 400): `{ "status": "invalid_input", "field": "shops[3].kw", "message": "kw must be a positive whole number" }`

A checker violation (an internal bug) returns HTTP 500 `{ "status": "error", "violations": [...] }`, never a wrong roster.

---

## 2. Dependency graph

```
T0 pack request ───────────────────────────────────────────────┐ (serializer/validator alignment)
T1 skeleton ─► T2 model ─► T3a DP value ─► T3b DP roster ─► T8 API ─► T9 reasons ─► T16 outputs+evidence ─► T18 freeze ─► T19 protected hour
     │            │            │                ▲             ▲  ▲
     │            ├─► T4 checker ───────────────┘             │  │
     │            └─────────────► T6 diagnose (min-fuel DP) ──┘  │
     └─► T7 validate ────────────────────────────────────────────┘
T3a ─► T5 vertical slice (server → solver, raw JSON)            T3a ─► T5b minute-150 run (at arrival)
T10 fixtures+client ─► T11 board ─► T12 panels+import/export ─► T14 print ─► T13 live API (needs T8)
T8 ─► T15 boundary suite ─► T16;   T13+T16 ─► T17 docs ─► T18
```

**Critical path:** T1 → T2 → T3a → T3b → T8 → T9 → T16 → T18 → T19.

**Parallel lanes:**

- **A, solver and API:** T1, T2, T3a, T3b, T8, T9.
- **B, screen:** T10, T11, T12, T14, T5, T13, T17.
- **C, verification:** T7, T4, T5b, T6, T15, T16.

---

## 3. Tasks

Priorities: **P0** = valid working submission; **P1** = required deliverables and robustness; **P2** = only if time remains.

---

### T0: Request the missing official pack (P0)

**Description:** ask the organizers for `schema.md`, `example_output.json` and the validator, and record the outcome.

**Acceptance criteria:**
- [ ] The request is sent by 10:50.
- [ ] Received files are saved in `official/`, or `KNOWN_ISSUES.md` says "not available as of HH:MM".

**Verification:** `ls official/`, or check the `KNOWN_ISSUES.md` entry.

**Dependencies:** none.

**Files:** `official/` (proposed), `KNOWN_ISSUES.md`.

**Scope / time:** XS / 5 min.

**Stop / fallback:** no reply means continue on the §1 contract; recheck at checkpoints 2 and 4.

---

### T1: Skeleton, git, test runner (P0)

**Description:**

- `package.json` with `start` (`node src/server.js`) and `test` (`node --test tests/`);
- a stub `src/server.js` that serves `public/` and answers `/api/roster` with 501;
- a placeholder `public/index.html`, `.gitignore`, a smoke test;
- `git init` and a first commit.

**Acceptance criteria:**
- [ ] `npm start` serves `/` on port 3000 (`PORT` overrides it).
- [ ] `npm test` shows 1 passing test.
- [ ] The first git commit exists.

**Verification:** `npm test`; `npm start &` then `curl -s localhost:3000/ | head -1`; `git log --oneline | head -1`.

**Dependencies:** none.

**Files:** `package.json`, `src/server.js`, `public/index.html`, `tests/smoke.test.js`, `.gitignore`.

**Scope / time:** XS / 10 min.

**Stop / fallback:** if git is not installed, record versions as dated copies in `evidence/versions/`.

---

### T2: Model and integer fuel arithmetic (P0)

**Description:** `src/solver/model.js` builds:

- litres as integer hundredths;
- outage slots and blocks;
- mandatory kW and mandatory value per slot;
- eligible vs never-eligible normal shops (kW > capacity − mandatory kW);
- `fuelFor(kw)`: the first level ≥ kW, with 0 for 0 kW.

**Acceptance criteria:**
- [ ] Worked example: `fuelFor` gives 0→0, 4→80, 9→160, 10→160.
- [ ] Sample: slots [2,3,4,5,7,8,9], blocks [[2-5],[7-9]], mandatory 5 kW, budget 1700.

**Verification:** `node --test tests/model.test.js`

**Dependencies:** T1.

**Files:** `src/solver/model.js`, `tests/model.test.js`.

**Scope / time:** S / 15 min.

**Stop / fallback:** drop the block helper; the DP detects resets from slot gaps.

---

### T3a: Exact DP forward pass, value and feasibility only (P0, heavy)

**Description:** port the planning spike into `src/solver/solve.js`:

- layered DP over outage slots;
- state = packed dark-run vector;
- a Pareto list of (fuel, value) per state;
- transitions only over subsets that include the forced shops (submask enumeration) and fit capacity and budget;
- grid gaps collapse to the zero state.

Returns `{feasible, value, fuelCents}`.

**Acceptance criteria:**
- [ ] Worked example: `value` 84, `fuelCents` ≤ 800.
- [ ] Sample: `value` 186 in ≤ 5 s.
- [ ] `tests/fixtures/m150_guess_1600.json` (our labelled guess): `feasible: false`.

**Verification:** `node --test tests/solve.test.js` (prints the sample time).

**Dependencies:** T2.

**Files:** `src/solver/solve.js`, `tests/solve.test.js`, `tests/fixtures/m150_guess_1600.json`.

**Scope / time:** M / 25 min.

**Stop / fallback:** at 25 min, reassess. If the values are wrong, compare against the spike for one 15-min box. Never ship with 84 failing.

---

### T3b: Roster reconstruction, tie-break, dominance speed-up, time guard (P0, heavy)

**Description:**

- parent pointers, giving `slots: [{slot, powered:[ids]}]`;
- deterministic tie-break: less fuel first, then fixed order;
- run-vector dominance: drop a label if another state at the same slot has every counter ≤, fuel ≤ and value ≥;
- an 8.5 s guard returning `optimal: false`.

**Acceptance criteria:**
- [ ] The reconstructed worked-example roster recomputes to 84 / 8.00 L with every run ≤ 2.
- [ ] Two runs give byte-identical output.
- [ ] Sample time ≤ the T3a time, so the speed-up did not regress.

**Verification:** `node --test tests/solve.test.js`

**Dependencies:** T3a.

**Files:** `src/solver/solve.js`, `tests/solve.test.js`.

**Scope / time:** M / 25 min.

**Stop / fallback:** drop dominance first; reconstruction is mandatory. The bug-fix cap for T3a and T3b together is 60 min.

---

### T4: Independent rule checker (P0)

**Description:** `src/solver/check.js(input, output)` returns violations for:

- capacity, fuel (integer), mandatory, dark runs with grid reset;
- each outage slot appearing exactly once; the `powered`/`dark` partition;
- recomputed totals; a missing reason.

It must not import `solve.js`.

**Acceptance criteria:**
- [ ] The brief's published worked-example roster (PDF p.4, hand-coded) passes, giving 84 / 8.00 L.
- [ ] Mutants are each caught: over capacity, 8.01 L, mandatory dark, 3-hour dark run, overlapping id, missing slot, wrong total.

**Verification:** `node --test tests/check.test.js`

**Dependencies:** T2.

**Files:** `src/solver/check.js`, `tests/check.test.js`, `tests/fixtures/worked_example_published_roster.json`.

**Scope / time:** M / 20 min.

**Stop / fallback:** ship the hard-rule checks first; partition and totals checks move into T15.

---

### T7: Input validation (P0)

**Description:** `src/solver/validate.js` returns either the input or `{field, message}`, covering brief rules 2, 4 and 9. It accepts unknown fields such as `_story`, an empty shop list and no outages.

**Acceptance criteria:**
- [ ] One test per invalid case, each naming the field: missing field, wrong list length, duplicate or blank id, `kw` ≤ 0 or non-integer, bad type, value < 0 or non-integer, more than 12 shops, fuel table not increasing or last level ≠ capacity, 3-decimal litres.
- [ ] The sample, the worked example, no-outage and empty-shops inputs all validate.

**Verification:** `node --test tests/validate.test.js`

**Dependencies:** T1.

**Files:** `src/solver/validate.js`, `tests/validate.test.js`.

**Scope / time:** M / 20 min.

**Stop / fallback:** unclear cases (zero capacity or budget, K = 0, non-increasing litres) are accepted and logged in `KNOWN_ISSUES.md`.

---

### Checkpoint 1, 11:35: solver values correct

**Conditions:**
- `npm test` is green for T2, T3a, T4 and T7.
- The values are 84 and 186.

**Decision:**
- **Go** if all conditions hold.
- **Fix** within 15 min if only speed fails.
- **No-go** if 84 fails: Lane A pairs with Lane C until it passes.

---

### T5: Vertical slice, request to solver result (P0)

**Description:** `src/solver/index.js` (`roster(raw)` = `JSON.parse` → solve) plus `POST /api/roster` in `server.js`, returning the raw solver result. This proves the end-to-end path before the full serializer exists.

**Acceptance criteria:**
- [ ] `curl` with the sample returns HTTP 200 and value 186.

**Verification:** `curl -s -X POST -H 'content-type: application/json' --data @inputs/sample_input.json localhost:3000/api/roster | head -c 200`

**Dependencies:** T3a, T1.

**Files:** `src/solver/index.js`, `src/server.js`.

**Scope / time:** XS / 10 min.

**Stop / fallback:** n/a.

---

### T5b: Minute-150 input intake (P0, at arrival, about 11:30)

**Description:** save the updated file unchanged as `inputs/minute150_input.json`. Run the current solver on it from scratch and record the status and time.

**Acceptance criteria:**
- [ ] The file is saved byte-for-byte; the status is recorded in `PHASE_STATUS.md`.
- [ ] If infeasible, T6 is confirmed as the top priority. If ok, the result passes `check.js`.

**Verification:** `node -e "const r=require('./src/solver/solve.js');console.log(r.solve(require('./inputs/minute150_input.json')))"` (exact export names fixed in T3a).

**Dependencies:** T3a.

**Files:** `inputs/minute150_input.json`, `PHASE_STATUS.md`.

**Scope / time:** XS / 10 min.

**Stop / fallback:** a malformed file becomes an `invalid_input` test case; ask the organizers.

---

### T6: Infeasibility diagnosis (P0)

**Description:** `src/solver/diagnose.js` returns `conflicts[]` from these checks, in order:

1. mandatory kW > capacity;
2. mandatory-only fuel > budget;
3. a never-eligible shop inside a block longer than K;
4. a min-fuel DP over the same states: "needs ≥ X L, budget Y L"; if even that is impossible, report the first slot where the forced shops exceed capacity.

**Acceptance criteria:**
- [ ] Each of the first three checks has a test fixture producing the right `rule`, shops and slots.
- [ ] The minute-150 guess (and the real file, if infeasible) gives `rule: "fuel"` with 17.60 vs 17.00 L, in < 2 s.

**Verification:** `node --test tests/diagnose.test.js`

**Dependencies:** T3a, T2.

**Files:** `src/solver/diagnose.js`, `tests/diagnose.test.js`, 3 fixtures in `tests/fixtures/`.

**Scope / time:** M / 20 min.

**Stop / fallback:** ship checks 1-3 plus the generic "no roster satisfies capacity, diesel and the dark-run rule together". **Never** answer `ok`.

---

### Checkpoint 2, 12:00: minute-150 handled, roster rebuilt

**Conditions:**
- T3b, T4, T6 and T7 tests are green.
- The sample roster passes `check.js`.
- The minute-150 status is known, with a correct diagnosis if infeasible.
- The T5 slice returns 186.

**Decision:**
- **Go** if all conditions hold.
- Otherwise a **15-min fix**; if it still fails, ship T6 in its fallback form.

---

### T8: Serializer and full API status mapping (P0)

**Description:**

- `src/solver/serialize.js` produces the §1 contract (or `schema.md`).
- `index.js` runs validate → solve → diagnose → serialize → check.
- `server.js` handles:
  - invalid JSON or `invalid_input` → 400;
  - `ok` and `infeasible` → 200;
  - a checker violation → 500;
  - a 1 MB body limit.

**Acceptance criteria:**
- [ ] Sample → 200 `ok` with 186 and every slot present.
- [ ] Minute-150 → 200 `infeasible` with conflicts (or `ok` and checker-clean).
- [ ] `{` → 400 naming the body.

**Verification:**
- `curl` with the sample, as in T5;
- `curl -s -o /dev/null -w '%{http_code}\n' -X POST --data '{' localhost:3000/api/roster` prints `400`;
- `node --test tests/api.test.js`.

**Dependencies:** T3b, T4, T6, T7.

**Files:** `src/solver/serialize.js`, `src/solver/index.js`, `src/server.js`, `tests/api.test.js`.

**Scope / time:** M / 20 min.

**Stop / fallback:** if `schema.md` conflicts, change only `serialize.js`.

---

### T9: Reasons for every dark entry (P0)

**Description:** `src/solver/explain.js` switches on the single dark shop and reports, with numbers:

- capacity ("+4 kW → 22 of 20 kW");
- budget ("+0.80 L → 17.60 of 17.00 L");
- never-eligible;
- zero value ("worth 0 this hour").

When `optimal: false`, the reason says "optimality not proven".

**Acceptance criteria:**
- [ ] Every dark entry in the sample and worked-example outputs has a reason containing a number.
- [ ] `check.js` reports no missing reasons.

**Verification:** `node --test tests/explain.test.js`

**Dependencies:** T8, T3b.

**Files:** `src/solver/explain.js`, `tests/explain.test.js`, `src/solver/index.js`.

**Scope / time:** M / 20 min.

**Stop / fallback:** capacity and budget reasons only. Anything else gets the true generic text "diesel or capacity is worth more in other hours of the optimal plan (this hour: value X)", logged in `KNOWN_ISSUES.md`.

---

### Checkpoint 3, 12:25: API end to end

**Conditions:**
- The 200/200/400 trio is correct.
- Every `ok` response passes `check.js`.
- Every ✗ has a reason.
- Everything is under 10 s.

**Decision:**
- **Go** if all conditions hold.
- Otherwise a **15-min fix**, else roll back to the checkpoint-2 commit with the T5 slice and minimal serializer.

---

### T10: Contract fixtures and API client (P0, Lane B)

**Description:** `tests/fixtures/contract_ok.json` and `contract_infeasible.json` in the §1 shape. `public/api.js`: `postRoster(json)` → `{httpStatus, body}`, handling network errors.

**Acceptance criteria:**
- [ ] The fixtures parse and match §1.
- [ ] `postRoster` returns both 200 and 400 bodies (against the T5 slice later).

**Verification:** open `public/index.html` (served by T1); the browser console logs the fixture.

**Dependencies:** none (§1).

**Files:** `public/api.js`, `tests/fixtures/contract_ok.json`, `tests/fixtures/contract_infeasible.json`.

**Scope / time:** XS / 10 min.

**Stop / fallback:** n/a.

---

### T11: Roster board (P0)

**Description:**

- one row per shop, columns 10:00-19:00;
- ✓/✗ in outage cells, a neutral "grid" otherwise;
- ★ for mandatory shops;
- each ✗ carries a `title` tooltip with its reason.

**Acceptance criteria:**
- [ ] The fixture renders 12 × 10 cells correctly.
- [ ] Every ✗ shows its reason on hover.

**Verification:** manual check in the browser with `contract_ok.json`.

**Dependencies:** T10.

**Files:** `public/index.html`, `public/app.js`, `public/styles.css`.

**Scope / time:** M / 25 min.

**Stop / fallback:** drop the tooltips; T12's list carries the reasons.

---

### T12: Per-hour panel, totals, reason list, import and export (P0)

**Description:**

- per hour: load vs capacity, fuel, running total vs budget;
- status, value, fuel, dark hours per shop;
- a list of every ✗ with its reason;
- infeasible conflicts in plain words;
- upload, paste, a Compute button, and Download output JSON (the exact response body).

**Acceptance criteria:**
- [ ] The displayed numbers equal the response fields.
- [ ] An infeasible fixture shows its conflicts.
- [ ] The downloaded file is byte-identical to the body.

**Verification:** manual check with both fixtures; after T13, `diff` the download against a `curl` result.

**Dependencies:** T11.

**Files:** `public/app.js`, `public/index.html`, `public/styles.css`.

**Scope / time:** M / 25 min.

**Stop / fallback:** totals and conflicts as plain text; paste-only input.

---

### T14: A4 print view (P0 basic, P1 polish)

**Description:** `@media print` hides controls and prints board, loads and fuel on one A4 page.

**Acceptance criteria:**
- [ ] The sample prints on one A4 page in the print preview.

**Verification:** browser print preview, saved to `evidence/print-sample.pdf`.

**Dependencies:** T12.

**Files:** `public/styles.css`.

**Scope / time:** S / 15 min.

**Stop / fallback:** landscape and smaller type. A basic print stylesheet must ship regardless.

---

### T13: Switch the screen to the live API (P0)

**Description:** the screen calls only `POST /api/roster`; the fixture path is removed.

**Acceptance criteria:**
- [ ] The network tab shows a POST for every compute.
- [ ] `grep -rn fixtures public/` is empty.

**Verification:** both checks above.

**Dependencies:** T8, T12.

**Files:** `public/app.js`.

**Scope / time:** XS / 10 min.

**Stop / fallback:** n/a.

---

### T15: Boundary and adversarial suite (P1)

**Description:** API-level tests starting the server on a random port. Cases:

- no outages; all outages; empty shops; 12 shops;
- K = 0 and K = 10;
- an oversized shop inside and outside a long block;
- mandatory kW equal to, and above, capacity;
- budget exactly equal to the need, and 0.01 L short;
- 3-decimal litres; duplicate ids; a bad fuel table; 13 shops; a string where a number belongs.

**Acceptance criteria:**
- [ ] Every case gets the correct status and HTTP code.
- [ ] Every `ok` is checker-clean and under 10 s.

**Verification:** `node --test tests/boundary.test.js`

**Dependencies:** T8.

**Files:** `tests/boundary.test.js`, `tests/fixtures/boundary/*.json`.

**Scope / time:** M / 20 min.

**Stop / fallback:** fix a failure only if it takes ≤ 20 min; otherwise log it in `KNOWN_ISSUES.md` with steps to reproduce.

---

### T16: Committed outputs and the evidence folder (P1)

**Description:**

- `outputs/sample_output.json`, `outputs/minute150_output.json` and `outputs/make.sh` (all via `curl`).
- `evidence/regression/`: a **real** breaking input, the output of the earlier commit, the fixed output, and the commit hash.
- `evidence/boundary/`: an input and its output.
- `evidence/run.sh` replays everything against the API.

**Acceptance criteria:**
- [ ] `sh outputs/make.sh && sh evidence/run.sh` regenerates identical files.
- [ ] `evidence/README.md` names the earlier commit and the fix.

**Verification:** `sh outputs/make.sh && sh evidence/run.sh && git diff --exit-code outputs/ evidence/`

**Dependencies:** T8, T9, T5b, T15.

**Files:** `outputs/*`, `evidence/README.md`, `evidence/run.sh`, `evidence/regression/*`, `evidence/boundary/*`.

**Scope / time:** S / 20 min.

**Stop / fallback:**
- **Standing rule from T1:** when a test finds a real bug, save its input and the current output to `evidence/regression/` before fixing it.
- If none has been captured by 12:30, use the earliest commit that fails a T15 case, with the true hash.
- **Never fabricate.**

---

### T17: Documentation of verified reality (P1)

**Description:** update the docs to match only what actually exists and was run:

- `README.md`: start, port, solver location, files the API and screen call, tests;
- `ARCHITECTURE.md`: the DP as main solver, plus measurements;
- `AI_HANDOFF.md`, `PHASE_STATUS.md`, `KNOWN_ISSUES.md`.

**Acceptance criteria:**
- [ ] A teammate cold-reading the README finds `src/solver/solve.js` in < 2 min.
- [ ] No doc mentions a test or feature that does not exist.

**Verification:** cold-read by a teammate; `grep -n "planned\|TODO" README.md` is empty.

**Dependencies:** T13, T16.

**Files:** the five docs.

**Scope / time:** S / 20 min.

**Stop / fallback:** the README is mandatory; the others may be shortened.

---

### Checkpoint 4, 12:45: screen on the live API

**Conditions:** the screen, driven by the real API, shows:
- the sample as `ok` with reasons;
- the minute-150 input with its correct status;
- an invalid paste as 400;
- a basic one-page print preview.

**Decision:**
- **Go** if all conditions hold.
- Otherwise a **10-min fix**, else ship a plain-text screen.

---

### T18: Freeze and clean-start check (P0, 12:50-13:00)

**Description:** copy the repository to a fresh folder (`git clone` or a copy), run `npm start` and `npm test`, run the curl trio, and regenerate the outputs and evidence.

**Acceptance criteria:**
- [ ] Everything passes from the fresh copy.
- [ ] The commit is tagged `freeze-1300`.

**Verification:** `git clone . /tmp/wso-clean && cd /tmp/wso-clean && npm test && npm start`, then the curl trio.

**Dependencies:** all P0 and P1 tasks.

**Files:** none.

**Scope / time:** XS / 10 min.

**Stop / fallback:** failures go to T19 as blockers.

---

### T19: Protected hour, audit, rehearsal, submission (P0, 13:00-14:00)

No features in this hour.

**Description:**

1. Fix correctness or run blockers only, each ≤ 30 min, rolling back to `freeze-1300` if a fix fails.
2. Run the official validator on `outputs/`, if supplied.
3. Each member rehearses three things: why greedy fails, the DP state and dominance, and the minute-150 diagnosis.
4. Create the ZIP or push before the freeze.

**Acceptance criteria:**
- [ ] The checkpoint-4 and T18 conditions are green on the submitted artifact.
- [ ] Every member gives the 2-minute explanation unaided.

**Verification:** `unzip -l submission.zip`, then repeat the T18 commands on the unzipped copy.

**Dependencies:** T18.

**Files:** none (fixes only).

**Scope / time:** M / 60 min, protected.

**Stop / fallback:** roll back to `freeze-1300`.

---

### P2: only if every P0 and P1 task is green before 12:40

- **P2-a:** a randomized oracle test comparing the DP with brute force on small random inputs (plus SciPy MILP if Python and SciPy are present). 20 min.
- **P2-b:** a labelled best-effort roster from the min-fuel DP for infeasible answers. 15 min.
- **P2-c:** a swap-based trade-off reason naming the competing shop. 20 min.

---

## 4. Five-hour timeline (actual clock) and fallback priorities

9:00-10:45 went on inspection, spikes, research and planning. Build starts 10:45.

| Time | Lane A: solver and API | Lane B: screen | Lane C: verification | Checkpoint / hard stop |
|---|---|---|---|---|
| 10:45-10:55 | T0, T1 | T10 | — | |
| 10:55-11:10 | T2 | T11 | T7 | |
| 11:10-11:35 | T3a | T11, T12 | T7, T4 | **CP1 11:35** |
| 11:30-11:45 | T3b | T5 (needs T3a) | **T5b at arrival** | |
| 11:45-12:00 | T3b | T12 | T6 | **CP2 12:00** |
| 12:00-12:20 | T8 | T14 | T6 finish, T15 fixtures | |
| 12:20-12:40 | T9 | T13 | T15 | **CP3 12:25** |
| 12:40-12:50 | T16 (outputs) | T17 | T16 (evidence) | **CP4 12:45** |
| 12:50-13:00 | T18 | T18 | T18 | **Freeze 13:00** |
| **13:00-14:00** | **T19, protected** | | | Submission done before 14:00 |

### Drop order if the schedule slips

Cut from the top; never the protected hour.

1. P2-a, P2-b, P2-c.
2. T14 polish; keep only the basic print stylesheet.
3. T11 tooltips; the T12 list carries the reasons.
4. T15 trimmed to six cases: no outages, empty shops, oversized shop, budget exact, 3-decimal litres, duplicate ids.
5. T17 trimmed to the README.
6. T9 trimmed to capacity and budget reasons plus the true generic fallback text.

### Never cut

T3a, T3b, T4, T6, T7, T8, T5b, T13, T16, and the README.

### Single-lane fallback (one person plus AI)

Run Lane A, then C's T7/T6, then B in compressed form: T10, T11 without tooltips, T12 paste-only, T13, basic T14. Then T16, T18 and T19. P2 is dropped.

---

## 5. Definition of done

- [ ] On a clean copy, `npm start` serves the screen and `POST /api/roster` on port 3000, offline, with no install.
- [ ] `npm test` is green, with counts quoted from an actual run.
- [ ] The sample gives `ok`, is checker-clean and (if available) official-validator-clean.
- [ ] The minute-150 input is recomputed fresh with the correct status and a numeric conflict when infeasible.
- [ ] `invalid_input` gives 400 naming the field; `infeasible` gives 200 naming rule, shops and slots.
- [ ] The screen shows every "at minimum" item from the brief, driven by the live API, including the one-page print.
- [ ] `outputs/` and `evidence/` exist and are reproducible by script; the regression evidence is a real defect with a real commit.
- [ ] The README locates the solver in under 2 minutes; docs claim only what was verified.
- [ ] Every team member can explain the algorithm and the minute-150 result unaided.

## 6. Recommended first task

**T0 and T1 now** (Lane A), with **T10** (Lane B) at the same time.

## Self-audit

- [x] Every task has at most 3 acceptance criteria, with verification commands that use the files the task creates.
- [x] Dependencies are explicit (§2 and per task).
- [x] Scope is XS, S or M only. The solver is split into T3a and T3b, each 25 min; heavy tasks are ≤ 25 min with a reassessment point.
- [x] An early vertical slice (T5) exists by about 11:45.
- [x] Checkpoints come every 2-4 tasks: 11:35, 12:00, 12:25, 12:45 and the 13:00 freeze.
- [x] The minute-150 update is handled at arrival (T5b) with the diagnosis (T6) scheduled around it.
- [x] 13:00-14:00 is protected; slips are absorbed by the drop list.
- [x] Nothing is claimed as implemented or tested. Planning measurements are labelled as scratch spikes.
