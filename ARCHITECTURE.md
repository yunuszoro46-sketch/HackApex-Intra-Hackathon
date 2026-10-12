# Architecture

## Requirements, as stated in the official brief

Sources: `Who_Stays_On_Problem_Statement.pdf` (the brief), `Juding_Criteria.pdf`, `inputs/sample_input.json`. Nothing below goes beyond them; open points are in `KNOWN_ISSUES.md`.

**Hours.** Slots 0-9 are 10:00-19:00 (each one hour, ending 20:00). Grid-on hour: everyone powered, no fuel, no roster entry, no value counted. A day with no outage is valid: empty roster, zero totals.

**Input fields.** `grid_available` (10 booleans), `generator_capacity_kw`, `fuel_budget_litres`, `fuel_table` (`load_kw`, `litres_per_hour`), `max_consecutive_dark`, `shops[]` (`id`, `kw`, `type` mandatory/normal, `value_per_slot` 10 numbers). The sample also carries a `_story` field.

**Rules.**

1. **Capacity:** powered kW in each outage hour ≤ capacity. A shop bigger than the generator can never be on in an outage.
2. **Fuel:** levels are whole kW, increasing, and the last level equals capacity. Charge the first level ≥ the hour's combined powered kW, once per hour, never per shop. Zero load costs zero fuel. The day's total must be ≤ budget, computed in whole hundredths of a litre with no tolerance.
3. **Mandatory:** every mandatory shop is on in every outage hour.
4. **Dark runs:** walk the ten hours for each normal shop. A dark outage hour adds one to the run; an on hour or a grid hour resets it. The run must never exceed `max_consecutive_dark`. `dark_hours` counts all dark outage hours; mandatory shops have 0.
5. **Objective:** value is the sum over outage hours of `value_per_slot[hour]` for every powered shop, mandatory shops included. Maximize it. Ties are equally good.

**Statuses.**

- `ok`: every outage hour appears exactly once; powered ∪ dark = all ids with no overlap; every dark entry has a reason with numbers; totals are recomputed from the roster.
- `infeasible`: HTTP 200. Say which rule and which shops/hours conflict; a labelled best-effort roster may be attached.
- `invalid_input`: HTTP 400. The message names the field. Covers a missing or mistyped field, wrong list length, duplicate ids, a bad fuel table, negative numbers, or more than two decimals in litres.

**Limits.** At most 12 shops. Each input must be answered in under 10 s. No internet. The screen must use the same `POST /api/roster` endpoint.

**Screen.**

- Roster board: one row per shop, columns 10:00-19:00, ✓/✗ in outage cells, "grid" in grid hours, mandatory shops marked.
- Per hour: load vs capacity, fuel that hour, running total vs budget.
- A reason for every ✗.
- Status, total value, total fuel, each shop's dark hours.
- Upload or paste input JSON; download output JSON.
- Print view on one A4 page.

**Deliverables.**

- One start command, with the port stated in the README.
- README naming where the solver lives.
- `evidence/`: one breaking input with the old and fixed output, and one boundary input with its output, run against the API.
- Our outputs on the sample and the minute-150 input.

## Stack

**Node.js 22 with zero dependencies.**

- Built-in `http` serves the API and the static screen.
- Vanilla HTML, CSS and JS for the screen, including print CSS.
- `node --test` for tests.

Why this stack:

- `npm start` works on a judge's machine with no install step and no internet, which is a hard rule.
- One language runs the solver, the server and the screen.
- The team has just shipped a Node project with the same zero-dependency pattern.

Rejected:

- **Python with SciPy's MILP or OR-Tools.** Either gives a proven optimum with little code, but needs `pip install` on the judge's machine. Missing packages offline would mean a dead demo.
- **React or Vite.** A build step and dependencies for a single board screen; the brief says decoration is not required.

## Components (each testable on its own)

```
public/index.html, app.js, styles.css
      │ fetch POST /api/roster (same endpoint as external callers)
src/server.js ───────────── static files, JSON body limit, 400/200 mapping
      │
src/solver/index.js  roster(input) → { httpStatus, body }
      ├─ validate.js  raw JSON → normalized model, or {field, message}   (no solving)
      ├─ solve.js     model → best roster (exact search)                 (no I/O, no text)
      ├─ explain.js   model + roster → one reason per dark (shop, hour)  (counterfactual checks)
      ├─ diagnose.js  model → named conflict when no roster exists
      └─ check.js     model + output → list of rule violations           (our own checker)
```

- **Pure functions throughout:** everything under `src/solver/` is plain data in and data out, so tests never need the server.
- **`check.js` runs on every answer before it is sent.** If it ever finds a violation, the API returns an error instead of a wrong roster. It is our implementation of the rules, **not** the official validator, which was not supplied.
- **Money-style arithmetic:** litres are converted to integer hundredths at validation (`round(x*100)`, rejecting non-integers). All fuel maths is integer, and litres are formatted only on output.

## Scheduling algorithm

### Why hour-by-hour greedy fails

The brief warns about this directly:

- It spends diesel at noon and leaves the evening dark.
- It starves the same low-value shop until the three-hour rule breaks.

The plan treats the day as one problem.

### Pre-processing and immediate infeasibility checks (`diagnose.js`)

1. `M` is the combined kW of the mandatory shops. If `M > capacity`, the input is **infeasible: capacity**, naming the mandatory shops and every outage hour.
2. Fuel for mandatory shops only, summed over the outage hours, must be ≤ budget. Otherwise it is **infeasible: fuel**, naming the minimum diesel needed against the budget.
3. A normal shop with `kw > capacity − M` can never be on while the mandatory shops are on. If any contiguous outage block is longer than `max_consecutive_dark`, it is **infeasible: dark-run rule**, naming the shop and block. Otherwise the shop is simply dark in every outage hour, with that reason.
4. Grid hours split the day into **outage blocks**. Runs reset at every grid hour, so blocks interact only through the shared diesel budget.

### Exact search: depth-first branch and bound over outage hours (`solve.js`)

- **State:** the hour index, each normal shop's current dark run, fuel used so far (integer hundredths) and value so far.
- **Choices at an hour:** every subset of eligible normal shops that:
  - contains every shop whose run is already `max_consecutive_dark`, since it must be on now;
  - fits within `capacity − M`.

  There are at most 2^12 = 4096 subsets, precomputed once per hour with load, fuel level and value. They are tried in descending value order.
- **Optimistic bound:** for each hour and fuel level, the best value that hour could reach ignoring the dark-run rule. A suffix knapsack over the remaining hours, indexed by remaining diesel in hundredths, gives the most value still reachable. Any branch whose value plus this bound cannot beat the best roster found is cut.
- **Memo:** a visited table keyed by (hour, run vector) keeps the best (value, fuel) pairs seen. A new state reached with no more value and no less fuel is dropped.
- **Starting incumbent:** a quick feasible roster (mandatory shops plus whatever the forced shops need, then filled greedily within the budget). It also proves feasibility early.
- **Result:** when the search finishes, the roster is **optimal for the rules as written**, with the proof given by exhaustion under a valid bound.
  - A time guard (target ≤ 8 s, under the brief's 10 s) stops the search if it ever runs long.
  - The best roster found is then returned with an explicit "optimality not proven within time" note. We never claim optimality we did not prove.

This is not proven fast on every possible input. Phase 3 opens with a performance test on a deliberately hard synthetic input: 12 normal shops, 10 outage hours, small kW and a tight budget.

### Fallback if the search is too slow on the hard case

Use an exact block-by-block dynamic programme. Run states only matter within a block, so each block yields a (fuel → best value) frontier, and the blocks are combined with a knapsack over diesel. If that is also too slow, keep the time-guarded search and state it.

### Reasons (`explain.js`), true by construction

For every dark (shop, hour) in the final roster, test switching that one shop on with everything else unchanged:

- **Capacity:** "would need 4 kW; 18 of 20 kW already in use."
- **Fuel:** "would lift the load 14→17 kW, from 2.00 to 2.80 L that hour; that leaves too little diesel for the hours where it earns more" (with the numbers).
- **Fixed by the rules:** "kW larger than capacity minus mandatory load."
- **No gain:** the hour's value is 0.

In an optimal roster, any single switch-on that stayed within the rules would add value, so every dark entry falls into one of these cases. The check is computed, not guessed.

For a trade-off between shops (shop A is dark so that shop B can be on), the reason names the competing shop and the value difference, worked out by swapping them.

### Infeasible answers (`diagnose.js`)

- Report the first failing check from the pre-processing steps with its numbers.
- If the pre-checks pass but the search finds no roster, which can happen through capacity and dark-run interactions inside a block, run the same search with "minimize fuel" as the objective. Report either "the dark-run rule needs at least X L but the budget is Y L", or the earliest hour where the forced shops alone exceed capacity, naming those shops.
- Optionally attach the minimum-violation best-effort roster, clearly labelled.

### Verification

- **Brute-force oracle** (`tools/brute.mjs`) for tiny inputs. Planning reproduced the brief's 84 / 8.00 L in about 12 s by exhaustive enumeration.
- **Randomized tests:** compare the solver's value with the oracle on many small random inputs. Every output also passes `check.js`.
- **Boundary inputs:**
  - no outages; all outages; empty shop list;
  - `max_consecutive_dark` of 0;
  - a shop bigger than the generator;
  - mandatory load equal to or above capacity;
  - budget exactly equal to the need;
  - litres with three decimals; duplicate ids; a fuel table whose last level is not capacity.
