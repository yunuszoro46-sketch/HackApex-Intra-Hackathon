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
| Screen | `public/index.html`, `public/app.js`, `public/styles.css` (`app.js` calls `POST /api/roster`) |

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

There are 23 tests, all using Node's built-in test runner:

- the brief's worked example: value 84 using exactly 8.00 L, matching the brief;
- the official sample: value 186;
- 300 random small markets compared against a brute-force solver (`tools/brute.js`);
- the independent checker against the brief's published roster and broken copies of it;
- every invalid-input case;
- HTTP boundary and adversarial cases.

## Outputs and evidence

- **`outputs/sample_output.json`:** our answer for the official sample. Regenerate it with `sh outputs/make.sh` while the server runs.
- **Minute-150 update:** save the official updated file as **`inputs/minute150_input.json`**, then run `sh outputs/make.sh`. This writes `outputs/minute150_output.json`, computed from scratch.
- **`evidence/`:** a real input that crashed an earlier version (out of memory), that version's captured failure, the fixed output, and a boundary pair (budget exactly 17.60 L vs 17.59 L). Replay them with `sh evidence/run.sh`. Details are in `evidence/README.md`.

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
