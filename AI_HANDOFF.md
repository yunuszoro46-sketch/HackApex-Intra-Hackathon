# AI handoff: Who Stays On?

Read in this order:

1. `README.md`
2. `ARCHITECTURE.md` (requirements, design, algorithm)
3. `KNOWN_ISSUES.md` (what is missing or ambiguous)
4. `PHASE_STATUS.md` (checklist and what has actually been run)

## Ground rules

- **The official materials are the source of truth:** the brief PDF, the judging-criteria PDF and `inputs/sample_input.json`. Do not add requirements that are not in them.
- **`schema.md`, `example_output.json` and the validator are missing.** Do not invent "official" versions. Ask for them, and keep the output shape provisional until they arrive.
- **Zero npm dependencies, Node 22.** Nothing may need the internet at runtime.
- **Solver code stays pure:** under `src/solver/`, no I/O and no HTTP.
- **Integer arithmetic for fuel:** hundredths of a litre.
- **Every answer passes `check.js` before it is returned.**
- **Do not claim optimality the search did not prove.** If the time guard stops the search, say so in the output.
- **Report tests honestly:** only what was actually run.
- **Judges will quiz a random team member:** keep the solver explainable, and leave short comments on why each step exists.

## Facts already confirmed

- **Worked example (PDF page 4):** brute force gives best value 84 at 8.00 L, matching the brief. This confirms the reading of the rules:
  - one fuel lookup per hour on the combined load, rounded up to the next level;
  - value counted only in outage hours, mandatory shops included;
  - runs reset on grid hours.
- **Sample input:**
  - 7 outage hours, in blocks 12:00-16:00 and 17:00-20:00;
  - mandatory pharmacy (3 kW) and ATM (2 kW);
  - 10 normal shops totalling 33 kW;
  - capacity 20 kW, budget 17.00 L.

## Next action (Phase 2)

1. Ask the project owner for `schema.md`, `example_output.json` and the validator.
2. Meanwhile, create `package.json` (`"start": "node src/server.js"`, `"test": "node --test"`), `src/solver/validate.js` and `src/solver/check.js`.
3. Move the brute-force spike into `tools/brute.mjs` as a general oracle that reads an input file.
4. Write tests for:
   - every invalid-input case listed in the brief's rule 9;
   - the checker on a hand-made valid roster (the worked example's published roster) and on deliberately broken copies.
