# Known issues and open questions

## Missing official materials

The brief says the pack contains `schema.md`, `example_output.json` (the worked example's correct output) and a validator. **None of the three was supplied** for Phase 1; only the brief PDF, the judging PDF and `sample_input.json` were.

Nothing in this repository replaces them. Until they arrive, the following are **provisional and must be checked against `schema.md`:**

1. **Output field names and shapes.** The brief names `status`, `roster` (per outage hour: `powered`, `dark` ids, each dark entry with a one-line `reason`), `value_total`, `fuel_total_litres` and per-shop `dark_hours`. Still unknown:
   - how an hour is identified (slot index, a "12:00" label, or both);
   - whether a dark entry is `{id, reason}` or something else;
   - whether `dark_hours` is an object or a list;
   - where infeasible details and the error message go;
   - whether litres are numbers or strings.
2. **Exact `invalid_input` rules.** Still unknown:
   - whether extra fields are allowed (the sample has `_story`, so at least that one must be accepted);
   - whether capacity must be a whole number;
   - whether `litres_per_hour` must be non-decreasing, or may be 0;
   - whether `max_consecutive_dark` may be 0;
   - whether the budget may be 0;
   - whether `value_per_slot` entries must be integers (rule 2 says "whole-number values ≥ 0", so yes).
3. **Validator behaviour:** how it is run (CLI or library) and its exact checks on reasons.

**Action:** ask for the full pack (`schema.md`, `example_output.json`, the validator) before Phase 5 (API output format). Phases 2-4 do not depend on the exact output shape.

## Ambiguities in the brief

- **Time budget:** the brief says "You have 3.5 hours" with an update at minute 150. The task prompt says a 5-hour hackathon. The checklist in `PHASE_STATUS.md` is sized to finish the core within 3.5 h, keeping the minute-150 rerun on schedule.
- **Minute-150 update:** "one grid-on hour becomes an outage … DESCO extended the afternoon block". In the sample, hour 6 (16:00) is the grid hour between the two afternoon blocks, so the two blocks would probably merge into one 8-hour block. This is not confirmed; the solver must not assume it.
- **"Explain every dark hour with the real rule or trade-off":** a reason that names a competing shop ("dark so that X stays on") needs a swap check; the plan computes it rather than writing generic text.

## Technical risks

- **Search time on hard hidden inputs:** 12 normal shops × 10 outage hours, with small kW and a tight budget, is the worst case for branch and bound. A performance test with a synthetic worst case is the first task of Phase 3. If needed, use the block DP fallback described in `ARCHITECTURE.md`, and keep the time guard so a response always arrives inside 10 s, labelled when optimality is not proven.
- **Floating-point litres:** must be converted to integer hundredths exactly once, at validation. A float sum compared with the budget could wrongly accept or reject a roster at exactly the budget.
- **Ties:** equal-value rosters are equally good, but the output should be deterministic. Break ties by lower fuel first, then a fixed shop and hour order, so reruns give the same roster.
