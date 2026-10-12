# Who Stays On?

On a load-shedding day, this app decides which shops at Shapla Shopping Complex the generator powers in each outage hour. It is the **provably best** roster that never trips the 20 kW generator, never runs out of diesel, always keeps the pharmacy and ATM on, and never leaves a shop dark more than the allowed hours in a row. Every dark hour gets a reason with numbers. When the day cannot be done, it says exactly why, for example "needs at least 17.60 L, budget 17.00 L".

## Start

```bash
npm start
```

Then open **http://localhost:3000**.

- **Requirements:** Node.js 20 or newer (developed and tested on Node 22.22). **No `npm install`**: there are no dependencies.
- **Port:** 3000. Use `PORT=8080 npm start` to change it.
- **Offline:** nothing is loaded from the internet, not even fonts.

## Using the screen

The screen is a form, so nobody needs to write JSON.

1. **Load the sample (Shapla, Thursday)** fills the form with `inputs/sample_input.json` and generates its roster straight away. **Clear form** empties every field.
2. Fill in or change the four sections:
   - **A. Generator:** capacity (kW), diesel budget (litres, at most two decimals), and the most hours in a row a normal shop may be dark.
   - **B. Grid schedule:** ten buttons, 10:00 to 19:00. Press an hour to switch it between grid (mains power, nothing to plan) and outage (the generator decides).
   - **C. Fuel table:** one row per load level: "up to this many kW costs this many litres per hour". Each outage hour's total load is rounded up to the first row at or above it. Rows can be added or removed; the last load must equal the capacity.
   - **D. Shops:** ID, kW, type (normal, or mandatory ★ = on in every outage hour) and a value for each of the ten hours. Up to 12 shops; add or remove rows.
3. Press **Generate roster**.
   - **OK** (green chip): the roster, totals, charts and a reason for every ✗.
   - **Infeasible** (amber chip): which rule cannot be met, with numbers, plus a best-effort roster marked "NOT a valid roster".
   - **Invalid input** (red chip): the server names the field, and the form outlines it in red. Nothing was computed.
4. **Download output JSON** and **Print roster** are in the header. Under **JSON import and export** you can fill the form from a JSON file or pasted text, or save the form as the JSON request the server receives.

**How the form becomes a request.** `public/form.js` turns the form into exactly the input JSON the API has always taken (`formToRequest`); the sample and the brief's worked example come back from the form byte-identical (`tests/form.test.js`). The form itself only stops what cannot be sent at all (an empty field, text that is not a number, a blank shop ID). Every rule (whole numbers, no negatives, unique IDs, the fuel-table rules, at most 12 shops) is still checked by the server, whose answer names the field.

## API

`POST /api/roster` takes the input JSON as the request body and returns the output JSON. The screen uses this same endpoint.

| Result | HTTP | Body |
|---|---|---|
| `ok` | 200 | `roster` (one entry per outage hour: `slot`, `time`, `powered` ids, `dark` [{`id`, `reason`}], `load_kw`, `fuel_litres`, `fuel_running_litres`), `value_total`, `fuel_total_litres`, `dark_hours` {id: n}, `capacity_kw`, `fuel_budget_litres`, `optimal` |
| `infeasible` | 200 | `message`, `conflicts` [{`rule`, `shops`, `slots`, `detail`}], `roster: []`, `best_effort` (labelled "NOT a valid roster", or `null`), `proven` |
| `invalid_input` | 400 | `field`, `message` |

```bash
curl -s -X POST -H 'content-type: application/json' --data @inputs/sample_input.json localhost:3000/api/roster
```

A command-line version uses the same pipeline. It exits 0 for ok/infeasible and 1 for invalid_input:

```bash
node src/cli.js inputs/sample_input.json
```

> The official `schema.md`, `example_output.json` and validator were **not supplied** to us. The field names above follow the brief's wording. If the schema differs, only `src/solver/serialize.js` needs to change (see `KNOWN_ISSUES.md`).

## Where the decision logic is

| What | File |
|---|---|
| **The solver (decision logic)** | **`src/solver/solve.js`**: read the comment at the top first |
| Why there is no roster (infeasible) | `src/solver/diagnose.js` |
| The reason for each dark shop | `src/solver/explain.js` |
| Input checks (`invalid_input`) | `src/solver/validate.js` |
| Diesel arithmetic, outage hours | `src/solver/model.js` |
| Output JSON format | `src/solver/serialize.js` |
| Independent rule checker, run on every answer before it is sent | `src/solver/check.js` |
| Pipeline used by the API and the CLI | `src/solver/index.js` |
| HTTP server (`POST /api/roster` and the screen) | `src/server.js` |
| Screen | `public/index.html`, `public/app.js`, `public/styles.css`; `public/form.js` converts the form to the request (`app.js` calls `POST /api/roster`); design tokens and rules in `DESIGN_SYSTEM.md` |

## How it decides (short version)

The solver plans the whole day at once, never hour by hour. Hour-by-hour greedy fails, as the brief warns: it spends the diesel at noon and starves one shop until the dark-hour rule breaks.

1. It walks the outage hours in order. The only things the past forces on the future are each shop's current run of dark hours and the diesel already spent.
2. For every possible pattern of dark runs, it keeps every way of getting there that is not beaten on both value and diesel.
3. In each hour it tries every set of shops that:
   - includes every shop that has already been dark the maximum number of hours;
   - fits the generator beside the mandatory shops;
   - is "full" for its fuel level, meaning no further shop could be added without moving to a dearer fuel level. Adding a shop that fits costs no diesel and never hurts, so nothing is lost by skipping the others.
4. Fuel for the hour is looked up once on the combined load. A grid hour resets every run.
5. At the end, the best value within the budget is the true optimum. The answer says `"optimal": true`.

**Infeasibility check:** before any of that, it computes the **least diesel** that can keep every other rule. If that is already over budget, the day is impossible, and that figure is the explanation.

**Speed:**

- An optimistic bound skips branches that cannot beat a roster already found.
- A memory and time guard guarantees an answer. If the guard ever triggers, the answer says `"optimal": false` and is never presented as optimal.

## Tests

```bash
npm test
```

There are 39 tests, all using Node's built-in test runner:

- the brief's worked example: value 84 using exactly 8.00 L, matching the brief;
- the official sample: value 186;
- 300 random small markets compared against a brute-force solver (`tools/brute.js`);
- the independent checker against the brief's published roster and broken copies of it;
- every invalid-input case;
- HTTP boundary and adversarial cases;
- fuel thresholds, grid resets of dark runs, and repeated requests;
- the screen's form conversion (`tests/form.test.js`).

A seeded random stress test on full-size inputs takes minutes, so it is not part of `npm test`:

```bash
node tools/fuzz.js 777 150
```

## Outputs and evidence

- **`outputs/sample_output.json`:** our answer for the official sample. Regenerate it with `sh outputs/make.sh` while the server runs.
- **Minute-150 update:** save the official updated file as **`inputs/minute150_input.json`**, then run `sh outputs/make.sh`. This writes `outputs/minute150_output.json`, computed from scratch.
- **`evidence/`:** two real inputs that broke earlier versions, each with that version's captured failure and the fixed output:
  - one ran out of memory;
  - one took 21 s and wrongly answered "infeasible".

  Plus a boundary pair (budget exactly 17.60 L vs 17.59 L). Replay them with `sh evidence/run.sh`. Details are in `evidence/README.md`.

## Not yet done or not verifiable here

- **Minute-150 input:** not received yet. Save it as `inputs/minute150_input.json`, then run `sh outputs/make.sh` with the server running.
- **`schema.md`, `example_output.json` and the official validator:** not supplied. Our output fields follow the brief's wording and are checked by our own independent checker, not the official one.
- **Hardest random inputs:** on 300 seeded random inputs, one answer was not proven optimal, and it is labelled `"optimal": false`. See `KNOWN_ISSUES.md`.

## Project layout

```
src/server.js          HTTP server (static screen + POST /api/roster)
src/cli.js             same pipeline from the command line
src/solver/            validate, model, solve, diagnose, explain, serialize, check, index
public/                the screen (no build step, no libraries)
inputs/                official sample input (+ minute150_input.json when it arrives)
outputs/               our outputs on the public inputs + make.sh
evidence/              regression and boundary evidence + run.sh
tests/                 npm test
tools/brute.js         brute-force oracle used by the tests
```

Planning and status documents: `IMPLEMENTATION_PLAN.md`, `IDEA_TO_ACTION.md`, `ARCHITECTURE.md`, `PHASE_STATUS.md`, `KNOWN_ISSUES.md`, `AI_HANDOFF.md`.
