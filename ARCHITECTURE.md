# Architecture (as built)

## Requirements source

The brief (`Who_Stays_On_Problem_Statement.pdf`), the judging criteria, and `inputs/sample_input.json`. The official `schema.md`, `example_output.json` and validator were not supplied (see `KNOWN_ISSUES.md`). The full requirement list is in `IMPLEMENTATION_PLAN.md` and `IDEA_TO_ACTION.md`.

## Components

```
public/index.html, app.js, styles.css      screen; fetch POST /api/roster (same endpoint as any caller)
src/server.js                              node:http; static files; 1 MB body limit; 200 / 400 / 405 / 404 / 500
src/cli.js                                 same pipeline from the command line (exit 0 ok/infeasible, 1 invalid)
src/solver/index.js   roster(input) = validate -> model -> solveMaxValue -> [diagnose] -> serialize -> checkRoster
  validate.js    brief rules 2, 4, 9 -> {field, message}; accepts unknown fields (the sample has "_story")
  model.js       litres -> integer hundredths; outage slots and blocks; fuelFor(kw); eligible vs never-fitting shops
  solve.js       exact search (below); solveMinFuel (least diesel keeping the other rules)
  diagnose.js    ordered infeasibility checks with numbers; labelled best-effort roster
  explain.js     reason for each dark (shop, hour)
  serialize.js   output JSON; the only file that knows field names
  check.js       independent re-check of every rule and total (imports nothing from the solver)
```

There are no dependencies and no database. Every request is computed from scratch.

## Solver (`src/solver/solve.js`)

### State and transitions

- **State:** the dark-run counter of every eligible normal shop (0…K), packed into a number. If K is at least the longest outage block, the rule cannot bind, and a single state is used.
- **Labels per state:** a Pareto list of (diesel in hundredths, value), with a parent pointer and the chosen set of shops.
- **Transition per outage hour:** a set of shops that:
  - contains every shop whose run already equals K;
  - fits within `capacity − mandatory kW`;
  - is **full for its fuel level**: no other eligible shop could be added without a dearer fuel level or going over capacity.

  Restricting to full sets loses no optimum. An added shop costs no diesel, adds value ≥ 0, and lowers its run, which only widens future choices.
- **Fuel:** charged once per hour from the fuel table on the combined load (mandatory plus chosen). A grid hour merges all states into the all-zero state.

### Order of work for one request

1. **Obvious impossibilities:** mandatory kW > capacity, or a never-fitting shop inside an outage block longer than K.
2. **`solveMinFuel`:** the least diesel that keeps capacity, mandatory and dark-run rules. If none exists, or it is over budget, the answer is **infeasible (proven)**. Otherwise its roster is a valid first floor.
3. **Quick pass:** a beam of 300 labels per hour finds a good roster quickly.
4. **Exact pass:** every non-dominated label is kept. A label is skipped only if its value plus an optimistic bound cannot reach the floor.
   - The bound is the best value per remaining hour at each fuel cost, ignoring the dark-run rule, combined over the remaining diesel by a knapsack in hundredths.
   - Ignoring a rule can only over-estimate, so nothing optimal is cut.
   - Completing this pass proves optimality: `"optimal": true`.
5. **Guard:** if the exact pass would exceed 2.5 million labels in an hour or the 7 s time allowance, the best roster from the quick passes is returned with `"optimal": false`. It is never called optimal.

### Measured on this machine (Node 22, CLI wall time including Node start-up, 12 Oct 2026)

| Input | Result | Time |
|---|---|---|
| Worked example | 84, 8.00 L | < 0.1 s |
| Sample | 186, 16.40 L | ~0.6 s |
| Sample + 16:00 outage | infeasible, needs 17.60 L | ~0.1-0.5 s |
| Evidence input (10 outage hours, 12 small shops, 22 L) | 403 | ~2-3 s |
| Harder synthetic variants (K = 3, or budget exactly at the minimum) | — | up to ~5.3 s |

## Reasons (`src/solver/explain.js`)

For each dark shop, switch on only that shop and report what breaks, with the numbers. The checks run in this order:

1. **Too big:** larger than the generator.
2. **Never fits:** cannot fit beside the mandatory shops.
3. **Capacity:** the hour would go over capacity.
4. **Diesel:** the hour would move to a dearer level, and the day would exceed the budget.
5. **No gain:** the shop is worth 0 that hour.

In an optimal roster one of these always applies.

- **When `optimal` is false:** the fallback text says so.
- **For an infeasible day's best-effort roster:** the reasons say "Least-diesel plan …".

## Infeasibility (`src/solver/diagnose.js`)

The checks run in order, and the first that applies is reported with its numbers:

1. **capacity:** mandatory kW > capacity.
2. **max_consecutive_dark:** a never-fitting shop in a block longer than K. The shop, the block and its kW are named.
3. **fuel:** mandatory-only diesel > budget.
4. **fuel:** the least diesel keeping every other rule > budget. The best-effort least-diesel roster is attached, labelled "NOT a valid roster".
5. **max_consecutive_dark:** at some hour the forced shops cannot fit together. That hour and those shops are named.
6. **search_limit:** used only if the time guard stopped the search before it could prove anything. This is not claimed as proven (`"proven": false`).
