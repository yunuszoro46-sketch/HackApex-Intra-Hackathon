'use strict';
// Solver correctness: the brief's worked example, the official sample, infeasible variants, and a randomized
// comparison against the brute-force oracle. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { roster } = require('../src/solver/index');
const { checkRoster } = require('../src/solver/check');
const { brute } = require('../tools/brute');

const load = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('worked example (brief p.4): value 84 using exactly 8.00 L, every rule kept', () => {
  const input = load('tests/fixtures/worked_example_input.json');
  const r = roster(input);
  assert.equal(r.httpStatus, 200);
  assert.equal(r.body.status, 'ok');
  assert.equal(r.body.value_total, 84);
  assert.equal(r.body.fuel_total_litres, 8);
  assert.deepEqual(checkRoster(input, r.body), []);
  assert.equal(r.body.roster.length, 6);
});

test('official sample: ok, checker-clean, value 186 (agrees with the independent MILP cross-check from planning)', () => {
  const input = load('inputs/sample_input.json');
  const t = Date.now(); const r = roster(input); const ms = Date.now() - t;
  assert.equal(r.body.status, 'ok');
  assert.equal(r.body.value_total, 186);
  assert.ok(r.body.fuel_total_litres <= 17);
  assert.deepEqual(checkRoster(input, r.body), []);
  assert.ok(ms < 10000, `took ${ms} ms`);
  for (const h of r.body.roster) for (const d of h.dark) assert.match(d.reason, /\d/);
});

test('same input twice gives byte-identical output (deterministic ties)', () => {
  const input = load('tests/fixtures/worked_example_input.json');
  assert.equal(JSON.stringify(roster(input).body), JSON.stringify(roster(clone(input)).body));
});

test('sample with 16:00 also an outage is infeasible: dark-run rule needs 17.60 L, budget 17.00 L', () => {
  const input = load('inputs/sample_input.json'); input.grid_available[6] = false;
  const r = roster(input);
  assert.equal(r.httpStatus, 200);
  assert.equal(r.body.status, 'infeasible');
  assert.equal(r.body.conflicts[0].rule, 'fuel');
  assert.match(r.body.conflicts[0].detail, /17\.60 L/);
  assert.ok(r.body.best_effort && /NOT a valid roster/.test(r.body.best_effort.label));
});

test('no outages: ok with empty roster and zero totals', () => {
  const input = load('inputs/sample_input.json'); input.grid_available = Array(10).fill(true);
  const r = roster(input);
  assert.equal(r.body.status, 'ok');
  assert.deepEqual(r.body.roster, []);
  assert.equal(r.body.value_total, 0);
  assert.equal(r.body.fuel_total_litres, 0);
});

test('empty shop list is valid: no load, zero fuel', () => {
  const input = load('tests/fixtures/worked_example_input.json'); input.shops = [];
  const r = roster(input);
  assert.equal(r.body.status, 'ok');
  assert.equal(r.body.fuel_total_litres, 0);
  assert.ok(r.body.roster.every((h) => h.powered.length === 0 && h.dark.length === 0));
});

// Randomized oracle comparison: small random markets, solver vs brute force.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function randomInput(r) {
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const cap = int(3, 10), nLevels = int(1, 3);
  const kws = new Set([cap]); while (kws.size < nLevels) kws.add(int(1, cap));
  const levels = [...kws].sort((a, b) => a - b);
  let litres = 0;
  const fuel_table = levels.map((kw) => ({ load_kw: kw, litres_per_hour: (litres += int(10, 90)) / 100 }));
  const grid = Array.from({ length: 10 }, () => r() < 0.55);
  while (grid.filter((g) => !g).length > 5) grid[grid.indexOf(false)] = true;
  const shops = [];
  const nMand = int(0, 1), nNorm = int(0, 4);
  for (let i = 0; i < nMand + nNorm; i++) {
    shops.push({ id: `s${i}`, kw: int(1, 6), type: i < nMand ? 'mandatory' : 'normal', value_per_slot: Array.from({ length: 10 }, () => int(0, 9)) });
  }
  return { grid_available: grid, generator_capacity_kw: cap, fuel_budget_litres: int(0, 600) / 100, fuel_table,
    max_consecutive_dark: int(0, 3), shops };
}

test('randomized: solver value equals brute-force optimum on 300 small markets, and every ok roster is checker-clean', () => {
  const r = rng(20261012);
  let ok = 0, infeasible = 0;
  for (let i = 0; i < 300; i++) {
    const input = randomInput(r);
    const norm = input.shops.filter((s) => s.type === 'normal').length, outages = input.grid_available.filter((g) => !g).length;
    if (norm * outages > 16) continue;
    const want = brute(input), got = roster(clone(input));
    const label = `case ${i}: ${JSON.stringify(input)}`;
    assert.equal(got.body.status, want.feasible ? 'ok' : 'infeasible', label);
    if (want.feasible) {
      ok++;
      assert.equal(got.body.value_total, want.value, label);
      assert.deepEqual(checkRoster(input, got.body), [], label);
    } else {
      infeasible++;
      assert.ok(got.body.conflicts.length > 0, label);
    }
  }
  assert.ok(ok > 50 && infeasible > 10, `coverage ok=${ok} infeasible=${infeasible}`);
});

test('reasons state the real dark streak and limit, and diesel reasons state the real spare diesel', () => {
  const input = load('inputs/sample_input.json');
  const b = roster(input).body;
  const K = input.max_consecutive_dark;
  const streak = {}; let prev = null;
  for (const h of b.roster) {
    if (prev !== h.slot - 1) for (const id in streak) streak[id] = 0; // grid hour between resets
    prev = h.slot;
    for (const id of h.powered) streak[id] = 0;
    for (const d of h.dark) {
      streak[d.id] = (streak[d.id] || 0) + 1;
      const m = d.reason.match(/Dark (\d+) hours? in a row so far \(limit (\d+)\)\.$/);
      assert.ok(m, `streak missing: ${h.time} ${d.id}: ${d.reason}`);
      assert.equal(Number(m[1]), streak[d.id], `${h.time} ${d.id}`);
      assert.equal(Number(m[2]), K);
      assert.ok(Number(m[1]) <= K);
      const f = d.reason.match(/^Diesel: .*\+(\d+\.\d\d) L\)\. The plan uses (\d+\.\d\d) of the (\d+\.\d\d) L budget, leaving (\d+\.\d\d) L spare/);
      if (f) {
        assert.equal(f[2], b.fuel_total_litres.toFixed(2));
        assert.equal(Number(f[4]), Number((Number(f[3]) - Number(f[2])).toFixed(2)));
        assert.ok(Number(f[1]) > Number(f[4]), 'extra diesel must exceed the spare diesel');
      }
    }
  }
});
