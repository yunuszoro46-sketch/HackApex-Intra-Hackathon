# Who Stays On?

Generator roster for Shapla Shopping Complex on a load-shedding day. For each outage hour it decides which shops are powered and which are dark, staying within generator capacity, the diesel budget, the mandatory-shop rule and the consecutive-dark-hours rule, and it explains every dark hour.

> **Status: Phase 1 (plan) only. Nothing is built yet.** `npm start` does not exist yet. See `PHASE_STATUS.md`.

## Start (planned)

```bash
npm start          # http://localhost:3000  (no install step, no internet needed)
```

- Node.js 22 or newer, **zero npm dependencies**.
- Port: **3000** (override with `PORT`).
- Serves the screen at `/` and `POST /api/roster`.

## Where things live (planned; see ARCHITECTURE.md)

| What | File |
|---|---|
| **Decision logic (the solver)** | `src/solver/solve.js` |
| Input validation (`invalid_input`) | `src/solver/validate.js` |
| Reasons for every dark shop | `src/solver/explain.js` |
| Rule checker run on every answer before it is returned | `src/solver/check.js` |
| API: `POST /api/roster` | `src/server.js`, which calls `src/solver/index.js` |
| Screen | `public/index.html` + `public/app.js`; it calls `POST /api/roster` like any other client |
| Tests | `tests/` (`node --test`) |
| Evidence required by the brief | `evidence/` |
| Our outputs on the public inputs | `outputs/` |

## Inputs in this repository

- `inputs/sample_input.json`: the official twelve-shop practice input (copied unchanged).
- `tests/fixtures/worked_example_input.json`: the brief's five-shop worked example, **transcribed from page 4 of the problem statement PDF**. The brief says its best roster scores **84** using **8.00 L**; a brute-force check during planning reproduced exactly 84 / 8.00 L.

## Not yet in hand

The brief refers to `schema.md`, `example_output.json` and a validator "in your pack". They were **not supplied** for this phase. The exact output format therefore cannot be confirmed yet; see `KNOWN_ISSUES.md`.
