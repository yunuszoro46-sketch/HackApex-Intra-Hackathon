'use strict';
// Seeded random stress test of the full pipeline on twelve-shop-sized inputs (not part of npm test: it takes minutes).
//   node tools/fuzz.js [seed] [count]
// Reports status counts, the slowest case, and any answer that is not proven (optimal: false or proven: false).
// Every "ok" roster is already re-checked by src/solver/check.js inside roster(); a failed check would show as "error500".
// This is a random sample, not an exhaustive proof.
const { roster } = require('../src/solver/index');
let seed = Number(process.argv[2] || 777);
const count = Number(process.argv[3] || 150);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
let worst = 0, worstCase = null; const counts = {}; const unproven = [];
for (let n = 0; n < count; n++) {
  const cap = ri(10, 30), levels = [];
  let k = 0; while (k < cap) { k = Math.min(cap, k + ri(2, 6)); levels.push(k); }
  let l = 0; const fuel_table = levels.map((kw) => ({ load_kw: kw, litres_per_hour: (l += ri(10, 90)) / 100 }));
  const ns = ri(6, 12), shops = [], nm = ri(0, 2);
  for (let s = 0; s < ns; s++) shops.push({ id: 's' + s, kw: ri(1, Math.ceil(cap / 2)), type: s < nm ? 'mandatory' : 'normal', value_per_slot: Array.from({ length: 10 }, () => ri(0, 9)) });
  const grid = Array.from({ length: 10 }, () => rnd() < 0.35);
  const input = { grid_available: grid, generator_capacity_kw: cap, fuel_budget_litres: ri(200, 2500) / 100, fuel_table, max_consecutive_dark: ri(1, 3), shops };
  const t = Date.now(); const r = roster(input); const ms = Date.now() - t;
  const key = `${r.body.status}${r.httpStatus}`; counts[key] = (counts[key] || 0) + 1;
  if (r.body.optimal === false || r.body.proven === false) unproven.push(n);
  if (ms > worst) { worst = ms; worstCase = n; }
}
console.log(JSON.stringify({ seed: process.argv[2] || 777, count, counts, slowest_ms: worst, slowest_case: worstCase, unproven }));
