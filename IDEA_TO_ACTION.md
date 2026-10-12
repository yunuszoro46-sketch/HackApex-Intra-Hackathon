# Who Stays On? From idea to action

**Status:** planning only, awaiting approval. No application code exists.

**Written:** 12 Oct 2026, 10:35. Hackathon clock: started 9:00; minute 150 is around 11:30.

- **Sources of truth:** `Who_Stays_On_Problem_Statement.pdf` (the brief), `Juding_Criteria.pdf`, `inputs/sample_input.json`.
- **Not supplied:** `schema.md`, `example_output.json`, the official validator (see `KNOWN_ISSUES.md`).
- **Skills:** the requested `idea_to_action` and `planning-and-task-breakdown` skills are not available in this environment (checked with a skill search), so this document follows the structure in the request directly.

**Labels:**

- **[O]** = official requirement, from the brief or the judging criteria.
- **[R]** = our recommendation.
- **[M]** = measured by us during planning, in scratch spikes outside the repository.
- **[L]** = from literature, via the research report `reports/Exact solvers for generator rosters.md`.

---

## 1. Founder's summary

1. **Problem [O]:** on a load-shedding day, decide for every outage hour which shops a 20 kW generator powers. The decision must:
   - stay under the generator's capacity;
   - keep total diesel within the day's budget, with fuel charged per hour from a step table on the **combined** load;
   - keep mandatory services (pharmacy insulin fridge, ATM) on;
   - never leave a normal shop dark more than `max_consecutive_dark` hours in a row (grid hours reset the count);
   - within those rules, maximize total `value_per_slot`.

2. **Who benefits [O]:**
   - Rokeya Apa, the market committee secretary, gets a plan she can trust and defend shop by shop.
   - Monir bhai, the generator operator, gets a printed sheet for the generator-room door that never trips the machine.
   - Shop owners get a reason for every dark hour.
   - Other markets (Uttara, Chattogram) can call the same API.

3. **Value proposition [R]:** one click turns today's schedule into a **provably best roster that never breaks a rule**, or a clear "impossible, and here is exactly why (needs 17.60 L, you have 17.00 L)". Every dark hour carries its reason in numbers.

4. **Success under the judging criteria [O]:**
   - Roster correctness: never a rule violation.
   - Value served: maximal.
   - Robustness: invalid vs infeasible handled correctly, boundaries correct, the minute-150 update recomputed.
   - Personal understanding: any team member can explain the algorithm and predict changes.
   - Working offline app: the API plus a screen showing schedule, loads, fuel and reasons.
   - Verification evidence: a real bug found and fixed, plus a boundary check.

5. **Hardest technical challenge [M]:** treating the day as **one** plan. Diesel spent at noon is gone for the evening, and the dark-run rule couples consecutive hours. Hour-by-hour greedy fails on both, as the brief itself warns. Our measurements also show that the **minute-150 update is probably infeasible**: both plausible versions need at least 17.60 L against a 17.00 L budget. Diagnosing infeasibility correctly is therefore as important as optimizing.

---

## 2. "How might we" and three solution directions

**How might we** give Rokeya Apa, for any day's load-shedding schedule, an hour-by-hour generator roster that provably never breaks a rule, serves the most value the diesel allows, and explains every dark hour, in under 10 seconds and with no internet?

| | **A. Reliability-first** | **B. Optimization-first** | **C. Balanced MVP (exact DP in pure JS)** |
|---|---|---|---|
| Idea | Greedy with repair: force shops at their dark limit, then fill hour by hour by value per diesel while reserving fuel for future forced shops | MILP or CP model solved by HiGHS (WASM) or CP-SAT, with the model shipped in the repository | Layered dynamic programme over outage hours; state = each shop's dark run; Pareto (fuel, value) per state; separate min-fuel DP for infeasibility |
| Constraint correctness | Valid if repair is right, but **can wrongly report "infeasible"** on a feasible day [L] | Exact if the solver is right; float tolerances need an integer re-check | Exact by construction; integer arithmetic throughout |
| Solution quality | No guarantee; greedy can be arbitrarily bad [L] | Proven optimal | **Proven optimal** (exhaustive over non-dominated states) [M: 84 and 186 agree with brute force and MILP] |
| Implementation complexity | Low (about 1 h) | Medium: model is easy, packaging is the risk | Medium: about 200 lines, ported from a working spike |
| Runtime and dependencies | ms, zero dependencies | ms-1 s, but needs a vendored WASM package; the npm registry was unreachable here before | 3-5 s on the sample [M], zero dependencies |
| Explainability to judges | Easy to describe, hard to defend ("why not that shop?") | "The solver said so": hard for a random team member to explain | "We keep every non-dominated way the day can go, hour by hour, then pick the best": explainable on a whiteboard |
| Deadline risk | Low build risk, **high scoring risk** | Medium-high (packaging, unfamiliar API) | Medium (port plus speed-ups), with the spike as a safety net |

---

## 3. Chosen strategy and rationale: C, the exact layered DP

Choice and ranking against the stated priority order:

1. **Never violate a hard rule when reporting ok.** The DP only builds rule-respecting transitions. An **independent checker** re-verifies every answer before it is sent; a violation becomes an error, never a wrong roster. [R]
2. **Invalid vs infeasible.** Validation never looks at feasibility. Feasibility is decided by the solver plus diagnosis. [R]
3. **Strong value.** The DP is exact, so its answer is the **true optimum under the rules as written**. [M] Planning measurements:
   - the worked example gives 84 (the official answer), and brute force over 201,105 rosters agrees;
   - the sample gives 186, agreeing with an independent MILP.
4. **Understandable.** Reasons come from computed "switch this shop on" checks. These are complete only when the roster is proven optimal [L], so a time-guarded answer gets weaker, clearly labelled reasons.
5. **Offline app and evidence:** zero npm dependencies, so `npm start` works with no install step.

What the DP **guarantees**:

- the returned `ok` roster satisfies every rule;
- its value is the maximum possible;
- `infeasible` is reported only when no roster exists, because the final layer is empty.

What it **does not** guarantee:

- runtime on arbitrary hidden inputs. It was measured at 3-5 s on sample-sized inputs, up to about 8 s with an unlimited budget [M].
  - Mitigations: the run-vector dominance rule [L], submask enumeration and typed arrays.
  - At 8.5 s a time guard returns the best roster found with `optimal: false` and the label "optimality not proven". This is never presented as optimal.
- a **unique** roster. Ties are broken deterministically (less fuel first, then fixed order).

Directions rejected:

- **A as the main solver:** no quality guarantee, and it can falsely report "infeasible". It is kept only as the incumbent and seed, if needed.
- **B:** packaging risk and weaker explainability. highs-js stays a **P2 test-only cross-check**, used only if the registry is reachable. SciPy MILP is a dev-only oracle where Python and SciPy exist.

---

## 4. MVP and what we will not build

### MVP: must build (every item traces to [O])

1. `POST /api/roster`: input JSON in, output JSON out; 200 for `ok` and `infeasible`, 400 for `invalid_input`; under 10 s; offline.
2. Exact solver (capacity, fuel step table, budget, mandatory, dark runs, grid resets, maximize value).
3. Input validation with field-naming messages (brief rules 2, 4, 9).
4. Infeasibility answer naming rule, shops and hours, with numbers. A labelled best-effort roster is optional per the brief.
5. A one-line reason with numbers for every dark entry; totals recomputed from the roster.
6. The screen:
   - roster board: shops × 10:00-19:00, ✓/✗ in outage cells, "grid" in grid hours, mandatory shops marked;
   - per-hour load vs capacity, and fuel with the running total vs budget;
   - reasons for every ✗;
   - status, total value, total fuel, dark hours per shop;
   - upload or paste input JSON; download output JSON;
   - one-page A4 print view.
7. The screen uses the same `POST /api/roster` endpoint.
8. One start command and a stated port; a README locating the solver within 2 minutes.
9. `evidence/`:
   - a real breaking input with the earlier output and the fixed output;
   - a boundary input with its output;
   - replayed against the API.
10. Committed outputs for the sample and the minute-150 input.

### Explicitly not building

Checked against the brief, which says "Not required: a deployed URL, a demo video, a pitch, login, a database, mobile layout".

| Excluded | Why not worth the time or risk |
|---|---|
| Authentication, user accounts | Listed as not required. Adds attack surface and minutes for zero marks |
| Database, persistence, cloud | Listed as not required. Each request is stateless |
| Deployment, hosting | Listed as not required. Judges run it offline, and hosting risks the "no internet" rule |
| AI chatbot or LLM features | AI use "does not directly contribute to the evaluation" and would need internet |
| Animations, visual effects | "Decoration is not required"; time goes to correctness |
| External APIs, CDN fonts or scripts | Breaks the no-internet rule |
| Analytics or dashboards beyond the brief | Not asked for |
| Mobile layout | Listed as not required. The desktop screen and print view are enough |
| Editing the roster by hand on screen | Not required, and it could produce rule-breaking rosters |
| Multi-day planning, tanker scheduling | Out of scope |

---

## 5. Architecture and dependency graph

See `IMPLEMENTATION_PLAN.md` §2 for the task graph and `ARCHITECTURE.md`, updated in T17, for module details.

```
Browser screen (public/index.html, app.js, styles.css)
   │ POST /api/roster  (identical to any external caller)
src/server.js ── static files; JSON parse; 1 MB limit; 200/400/500 mapping
   │
src/solver/index.js  roster(raw) = validate → solve → (diagnose) → explain → serialize → check
   ├─ validate.js   raw → model input | {field, message}               [no feasibility logic]
   ├─ model.js      litres→hundredths, outage slots/blocks, fuelFor(kw), eligible shops
   ├─ solve.js      exact layered DP, Pareto labels, reconstruction, time guard
   ├─ diagnose.js   quick checks + min-fuel DP → conflicts[] with numbers
   ├─ explain.js    one reason per dark (shop, hour) from switch-on checks
   ├─ serialize.js  output JSON (provisional contract until schema.md arrives)
   └─ check.js      independent rule checker (does not import solve.js)
```

---

## 6. Implementation plan

See `IMPLEMENTATION_PLAN.md` (version 2).

## 7. Five-hour timeline and fallback priorities

See `IMPLEMENTATION_PLAN.md` §4.

---

## 8. Judging criteria to evidence

| Criterion [O] | Feature that satisfies it | Reproducible test or demo | Evidence file | Remaining risk |
|---|---|---|---|---|
| 1. Roster correctness | Rule-respecting DP plus `check.js` gate on every answer | `npm test` (`check.test.js`, `solve.test.js`, `boundary.test.js`); curl on the sample | `outputs/sample_output.json`, `evidence/boundary/*` | Output format may not match the unseen `schema.md` |
| 2. Value served | Exact DP | Worked example = 84; sample = 186 (cross-checked by MILP in planning); P2 randomized brute-force comparison | `tests/solve.test.js`, `evidence/README.md` (cross-check table) | Time guard on very hard hidden inputs (labelled if triggered) |
| 3. Robustness | Validation (400), diagnosis (200 infeasible), minute-150 recomputation, boundary suite | `node --test tests/boundary.test.js`; `sh evidence/run.sh` | `outputs/minute150_output.json`, `evidence/boundary/*` | Unclear edge cases (zero budget, extra fields) pending `schema.md` |
| 4. Personal understanding | Plain DP plus computed reasons; rehearsal in T19 | Each member explains: why greedy fails, the DP state, the minute-150 diagnosis | Section 10 pitch and spec | Random member unprepared, so rehearsal is scheduled |
| 5. Working application | `npm start`, offline, screen on the live API, print view | Clean-copy start, then the curl trio, then screen walk-through | README start section; `evidence/screens/` (optional) | Node version on the judge's machine (≥ 22.13 stated) |
| 6. Verification evidence | Standing rule: capture a real bug before fixing it; boundary inputs | `sh evidence/run.sh` regenerates outputs | `evidence/regression/*` (real commit hash), `evidence/boundary/*` | No genuine bug captured by 12:30, so the documented fallback in T16 applies (never fabricated) |

Tests planned, by area:

| Area | Tasks |
|---|---|
| Mandatory always on | T4, T5 |
| Capacity, including a shop bigger than capacity minus mandatory | T4, T15 |
| Fuel step lookup on the combined load, exact boundaries, zero load = 0 | T2 |
| Budget exactly equal, and 0.01 L short | T15 |
| Dark runs at K and K+1; grid-hour reset | T4 |
| `max_consecutive_dark` = 0 | T15 |
| Partition of `powered` and `dark`, each hour once | T4 |
| Recomputed totals | T4 |
| Invalid cases | T7 |
| Infeasible categories | T6 |
| Sample | T3b |
| Official updated input | T5b |

---

## 9. Risk register and hidden assumptions

| Risk | Likelihood | Impact | Early warning sign | Mitigation | Fallback decision |
|---|---|---|---|---|---|
| Solver wrong (rule broken, or not optimal) | Low | Very high | `check.js` flags an output; worked example ≠ 84 | Exact DP; independent checker; brute-force and MILP cross-checks from planning | Return a 500 rather than a wrong roster; fix within the 60-min bug cap |
| Fuel-table interpretation | Low-medium | High | Worked-example fuel ≠ 8.00 L | "First level ≥ load", once per hour, zero load = 0, integer hundredths; tests at exact level boundaries | Re-read brief rule 4; the worked example is ground truth |
| Minute-150 input infeasible and mishandled | **High** that it is infeasible | High | T5b shows `feasible: false` before diagnosis exists | Diagnosis (T6) scheduled **before** 11:30 | Generic conflict message plus quick checks; never report `ok` or `invalid_input` |
| Solver too slow on a hidden input | Low-medium | High | Sample > 5 s on the dev laptop | Dominance, submasks, typed arrays; 8.5 s guard with `optimal: false` | Accept a guarded answer, labelled |
| Package installation fails | Medium (seen earlier) | High if any dependency | `npm install` 403 | Zero dependencies | n/a |
| API and frontend integration | Medium | Medium | Screen still on fixtures at 12:20 | Contract fixed in §1 of the plan; fixtures from minute one; T13 is a 10-min switch | Basic screen: board plus text totals |
| Time overrun | Medium-high | High | Checkpoint missed by > 10 min | Hard stops per task; drop list in plan §4 | Drop P2, then print polish, then tooltips. **Never the protected hour** |
| Missing or invented evidence | Medium | Medium | No bug captured by 12:15 | Standing capture rule from T1; git commits | Earliest real failing commit (T16 fallback), never fabricated |
| Output format differs from `schema.md` | Medium | High | Pack arrives with different field names | Only `serialize.js` changes | Adapt the serializer within 15 min |
| A random team member can't explain the algorithm | Medium | High | Rehearsal stumbles | Two-level explanation (section 10); comments on why each step exists | Second rehearsal in the protected hour |
| Misleading documentation | Medium | Medium | Docs mention unbuilt features | T17 rule: document only verified facts | Trim the docs rather than overclaim |

### Hidden assumptions and open questions (not silently resolved)

1. The exact output field names and shapes: `schema.md` is missing.
2. Whether unknown fields (`_story`) must be accepted. Assumed **yes**, because the official sample has one.
3. Whether a capacity of 0, a budget of 0, `max_consecutive_dark` of 0, or non-increasing litres are valid. Assumed valid pending the schema; logged.
4. Whether the official validator rejects extra output fields (e.g. `load_kw`). They are kept in the serializer, ready to remove.
5. The minute-150 change. Assumed only "one grid hour becomes an outage"; both guesses are infeasible. The real file decides.
6. Team size: lanes assume two or three people; a solo plan is in the implementation plan.
7. The judges' Node version. We state ≥ 22.13 in the README.

---

## 10. Explained at two levels

### The pitch, for a non-technical judge

When the power goes off, our app tells the market exactly which shops the generator should run each hour. It never overloads the generator or runs out of diesel, and it always keeps the pharmacy and ATM on. It gets the most value out of every litre, and explains why each shop is dark. If the day simply can't be done with the diesel available, it says so, and says how much more is needed.

### The technical specification, for an engineer

- **Input [O]:**
  - `grid_available` (10 booleans, slots 10:00-19:00);
  - `generator_capacity_kw`;
  - `fuel_budget_litres`;
  - `fuel_table` [{`load_kw`, `litres_per_hour`}], whole-kW levels, increasing, the last equal to capacity;
  - `max_consecutive_dark` (K);
  - `shops` [{`id`, `kw`, `type`, `value_per_slot`[10]}], at most 12.
- **Decision:** for each outage slot, the set of powered shops.
- **Constraints [O]:**
  - Σkw(powered) ≤ capacity;
  - Σ_h fuel(level(Σkw_h)) ≤ budget, in integer hundredths, one lookup per hour on the combined load, zero load = 0;
  - mandatory shops are always on;
  - per normal shop, its consecutive dark run over the slot sequence (reset by grid slots) stays ≤ K.
- **Objective [O]:** maximize Σ over outage slots and powered shops of `value_per_slot[slot]`.
- **Algorithm [R]:**
  1. Precompute, per outage slot, every subset of eligible normal shops with its load, fuel and value. A shop whose kW exceeds capacity minus the mandatory load is never eligible.
  2. Layered DP over slots. State = vector of dark-run counters, packed into an integer. Each state holds a Pareto list of (fuel, value) labels with parent pointers.
  3. Transitions use subsets that contain every shop already at K, respect capacity and stay within budget.
  4. A grid slot collapses all states to the zero vector.
  5. Labels dominated on (all counters ≤, fuel ≤, value ≥) are discarded. This is exact [L]; lower counters never restrict future choices.
  6. The answer is the maximum value in the final layer, with ties broken by less fuel, then a fixed order. It is reconstructed via the parent pointers.
  7. An empty final layer means **infeasible**. Diagnosis runs quick checks (mandatory kW > capacity; mandatory-only fuel > budget; a never-eligible shop inside a block longer than K) and then a min-fuel DP over the same states, reporting "needs ≥ X L, budget Y L".
- **Reasons [R]:** for each dark (shop, slot), switch only that shop on and report the first rule broken, with numbers: capacity, budget, never-eligible, or "worth 0 this hour". This is complete for a proven-optimal roster [L]. A time-guarded roster says "optimality not proven".
- **API [O]:** `POST /api/roster` gives 200 `ok` or `infeasible`, and 400 `invalid_input` with the field named. A non-`ok` answer never contains a roster presented as valid; a best-effort roster is labelled. Our own screen calls the same endpoint.
- **Verification [R]:**
  - `check.js` re-derives every rule independently on every answer.
  - Unit and boundary tests run with `node --test`.
  - Planning cross-checks: brute force (84) and SciPy MILP (84, 186, infeasibles).
  - `evidence/run.sh` replays the evidence inputs against the running API.

---

## 11. Checkpoints, definition of done, first task

See `IMPLEMENTATION_PLAN.md` §3-§6. In short:

- **Checkpoints** at 11:35 (solver values correct), 12:00 (minute-150 handled, roster rebuilt), 12:25 (API end to end), 12:45 (screen on the live API) and 13:00 (freeze, clean start).
- **Done** means every MVP item in section 4 has been demonstrated from a clean copy.
- **First task:** T0 (request the missing pack) together with T1 (skeleton, git, test runner).

## Feasibility audit

- It is now 10:35 and no code exists. The plan in `IMPLEMENTATION_PLAN.md` fits by running **two to three lanes** until 13:00, with P2 work and print polish as the first cuts.
- A single person plus AI must use the minimum viable submission path in that plan. It still meets every hard rule and every "at minimum" screen item.
- Every hour of further planning comes directly out of build time. **Recommendation: approve and start T0 and T1 now.**
