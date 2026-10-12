# AI handoff: Who Stays On?

Read in this order:

1. `README.md`
2. `ARCHITECTURE.md` (design as built, measurements)
3. `KNOWN_ISSUES.md`
4. `PHASE_STATUS.md` (what was actually run)
5. `evidence/README.md`

## Ground rules

- **The official materials are the source of truth:** the brief PDF, the judging-criteria PDF and `inputs/sample_input.json`. Do not add requirements that are not in them.
- **`schema.md`, `example_output.json` and the validator are missing.** Do not invent "official" versions. The output shape lives only in `src/solver/serialize.js`.
- **Zero npm dependencies; Node 22; no internet at runtime.**
- **`src/solver/` has no I/O.** `server.js` and `cli.js` are thin wrappers around `src/solver/index.js`.
- **Fuel is handled in integer hundredths of a litre.**
- **Every `ok` answer passes `check.js` before it is returned.** That check must stay independent of the solver.
- **Never claim optimality the search did not prove** (`optimal`, `proven` flags).
- **After any change to `solve.js`, run `npm test`.** The 300-case oracle comparison is the guard against losing optimality.
- **`evidence/` and `outputs/` hold real API outputs.** Regenerate them with their scripts; never hand-edit them.

## Confirmed facts

- **Worked example:** 84 at 8.00 L.
- **Sample:** 186 at 16.40 L of 17.00 L, proven optimal.
- **Sample with 16:00 or with 11:00 made an outage** (plausible minute-150 changes): infeasible. At least 17.60 L is needed.
- **Earlier crash:** commit `41cf264` ran out of memory on `evidence/regression/input_all_outage_small_shops.json`. Fixed in `409a00e`.

## Next action

1. Minute-150 input: see `PHASE_STATUS.md` "Still to do".
2. If the schema arrives: change `serialize.js` and `check.js` together, then update the README API table and the tests.
