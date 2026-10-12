'use strict';
// Brute-force oracle for SMALL inputs: tries every possible roster and keeps the best one that obeys every rule.
// Written independently of the solver; used by the tests to confirm the solver's optimal value.
//   node tools/brute.js path/to/small_input.json
// Practical only for (normal shops x outage hours) up to about 20.

function brute(input) {
  const cap = input.generator_capacity_kw, K = input.max_consecutive_dark;
  const budget = Math.round(input.fuel_budget_litres * 100);
  const table = input.fuel_table.map((l) => [l.load_kw, Math.round(l.litres_per_hour * 100)]);
  const fuelOf = (kw) => { if (kw === 0) return 0; const lv = table.find(([k]) => k >= kw); return lv ? lv[1] : Infinity; };
  const outage = []; input.grid_available.forEach((g, h) => { if (!g) outage.push(h); });
  const mand = input.shops.filter((s) => s.type === 'mandatory'), norm = input.shops.filter((s) => s.type === 'normal');
  const bits = norm.length * outage.length;
  if (bits > 24) throw new Error('too big for brute force');
  let best = null;
  for (let combo = 0; combo < 2 ** bits; combo++) {
    let value = 0, fuel = 0, ok = true;
    const run = norm.map(() => 0);
    for (let h = 0; h < 10 && ok; h++) {
      const oi = outage.indexOf(h);
      if (oi < 0) { run.fill(0); continue; }
      let load = 0;
      for (const s of mand) { load += s.kw; value += s.value_per_slot[h]; }
      norm.forEach((s, i) => {
        if (Math.floor(combo / 2 ** (oi * norm.length + i)) % 2) { load += s.kw; value += s.value_per_slot[h]; run[i] = 0; }
        else if (++run[i] > K) ok = false;
      });
      if (load > cap) ok = false;
      fuel += fuelOf(load);
    }
    if (ok && fuel <= budget && (!best || value > best.value || (value === best.value && fuel < best.fuel))) best = { value, fuel };
  }
  return best ? { feasible: true, value: best.value, fuelCents: best.fuel } : { feasible: false };
}

module.exports = { brute };
if (require.main === module) console.log(JSON.stringify(brute(JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')))));
