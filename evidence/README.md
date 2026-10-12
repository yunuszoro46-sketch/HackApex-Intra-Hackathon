# Verification evidence

Everything here runs against the API. Start the server (`npm start`), then:

```bash
sh evidence/run.sh
```

Set `PORT` if the server is not on 3000. The script rewrites the output files; `git diff` shows they are reproduced exactly.

## 1. An input that broke an earlier version: `regression/`

| File | What it is |
|---|---|
| `input_all_outage_small_shops.json` | Input we built: all ten hours are outages, and twelve small shops (1-3 kW) that all fit on the generator together, with 22 L of diesel. Almost every set of shops is allowed in every hour, which is the largest search the solver can face |
| `before_output_commit_41cf264.txt` | What commit `41cf264` did with it through the API: **no answer**. After 45 s the server process was killed by the operating system for using about 5.9 GB of memory, and the server stayed down. Captured at 10:47 on 12 Oct 2026 |
| `after_output.json` | The fixed version (commit `409a00e` and later) through the API: `ok`, value **403**, 21.60 L of 22.00 L, `"optimal": true`, in about 2 s |

**Cause:** the exact search kept every non-dominated (diesel, value) pair for every pattern of dark runs, and with this input those pairs ran into the tens of millions.

**Fix (`src/solver/solve.js`):**

1. The search only tries sets of shops that are "full" for their fuel level. Adding a shop that fits without raising the fuel level costs no diesel and never lowers value, so an optimal roster made only of such sets always exists. The 300-case brute-force comparison in `npm test` confirms the optimum is unchanged.
2. Before the full search, it computes the least diesel that keeps every other rule. If that is over budget, it stops: the day is infeasible, and that number explains why.
3. A quick first pass finds a good roster. The exact pass then skips any branch whose optimistic bound cannot beat it.
4. A memory and time guard. If it ever triggers, the answer is labelled `"optimal": false` instead of crashing.

The regression is kept as an automated test: `tests/api.test.js`, "regression input … answers optimally instead of crashing".

## 2. Boundary check: `boundary/`

The official sample with 16:00 also turned into an outage, one plausible minute-150 change. Keeping every shop within 2 dark hours in a row then needs **exactly 17.60 L** at minimum.

| Input | Budget | Output | Result |
|---|---|---|---|
| `input_budget_exact.json` | 17.60 L | `output_budget_exact.json` | `ok`, uses 17.60 L exactly, value 185 |
| `input_budget_one_hundredth_short.json` | 17.59 L | `output_budget_one_hundredth_short.json` | `infeasible`: "needs at least 17.60 L … the budget is 17.59 L, 0.01 L short" |

This shows the diesel rule is applied in whole hundredths with no rounding tolerance (brief rule 4), and that the infeasible answer carries the exact numbers. It is also an automated test: `tests/api.test.js`, "boundary: budget exactly the minimum needed…".

## 3. How we test in general

- **`npm test`** runs 24 tests:
  - the brief's worked example: 84 at 8.00 L, matching the brief;
  - the official sample: 186;
  - 300 random small markets compared against an independent brute-force solver (`tools/brute.js`);
  - our rule checker against the brief's published roster and seven kinds of broken copies;
  - every invalid-input case naming its field;
  - HTTP boundary and adversarial cases.
- **On every answer:** the API itself runs the independent checker (`src/solver/check.js`) before sending an `ok` roster. If a rule were ever broken, it would return an error instead of a wrong roster.
- **During planning**, separately from these tests, an independent integer-programming model (SciPy/HiGHS) agreed with our values: 84, 186, and infeasible for both plausible minute-150 changes.
