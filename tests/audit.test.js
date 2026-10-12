'use strict';
// Gaps found in the submission audit (12 Oct 2026): fuel-table thresholds, grid resets, more checker mutants,
// more invalid-input cases, and repeated independent requests through one server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { roster } = require('../src/solver/index');
const { makeFuelFor } = require('../src/solver/model');
const { checkRoster } = require('../src/solver/check');
const { brute } = require('../tools/brute');
const { start } = require('../src/server');

const read = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const worked = read('tests/fixtures/worked_example_input.json');

// A tiny market used by several tests: capacity 10, levels 4 / 7 / 10 kW (0.80 / 1.20 / 1.60 L).
function market({ grid, budget = 20, K = 2, shops }) {
  return {
    grid_available: grid, generator_capacity_kw: 10, fuel_budget_litres: budget, max_consecutive_dark: K,
    fuel_table: [{ load_kw: 4, litres_per_hour: 0.8 }, { load_kw: 7, litres_per_hour: 1.2 }, { load_kw: 10, litres_per_hour: 1.6 }],
    shops,
  };
}
const shop = (id, kw, type = 'normal', v = 1) => ({ id, kw, type, value_per_slot: Array(10).fill(v) });

test('fuel lookup: exactly at a level, between levels, zero load, and over capacity', () => {
  const f = makeFuelFor([{ kw: 4, cents: 80 }, { kw: 7, cents: 120 }, { kw: 10, cents: 160 }]);
  assert.equal(f(0), 0, 'zero load burns nothing');
  assert.equal(f(1), 80);
  assert.equal(f(4), 80, 'exactly at a level uses that level');
  assert.equal(f(5), 120, 'between levels rounds up to the next level');
  assert.equal(f(7), 120);
  assert.equal(f(8), 160);
  assert.equal(f(10), 160);
});

test('fuel lookup end to end: one lookup on the combined load per hour (brief p.3: 3+4+2+1 kW = 10 kW -> 1.60 L)', () => {
  // One outage hour, every shop must be on (K = 0): pharmacy 3 + tailor 4 + photocopy 2 + tea 1 = 10 kW.
  const grid = Array(10).fill(true); grid[2] = false;
  const i = market({ grid, K: 0, shops: [shop('pharmacy', 3, 'mandatory', 5), shop('tailor', 4), shop('photocopy', 2), shop('tea_stall', 1)] });
  const b = roster(i).body;
  assert.equal(b.status, 'ok');
  assert.equal(b.roster[0].load_kw, 10);
  assert.equal(b.fuel_total_litres, 1.6, 'charged once on 10 kW, not per shop');
  // A load of 5 kW (between 4 and 7) costs the 7 kW level.
  const j = market({ grid, K: 0, shops: [shop('pharmacy', 3, 'mandatory'), shop('tea', 2)] });
  assert.equal(roster(j).body.fuel_total_litres, 1.2);
  // No shops at all in an outage hour: zero load, zero fuel.
  const z = market({ grid, shops: [] });
  assert.equal(roster(z).body.fuel_total_litres, 0);
  assert.equal(roster(z).body.roster[0].fuel_litres, 0);
});

test('dark runs: reaching the limit is allowed, and a grid hour resets the run', () => {
  // Shop "big" (8 kW) never fits beside the 3 kW mandatory shop, so it is dark in every outage hour.
  // Outages 12-13 and 15-16 with a grid hour at 14:00 between: runs of 2 and 2, so K = 2 is feasible.
  const grid = Array(10).fill(true); grid[2] = grid[3] = grid[5] = grid[6] = false;
  const i = market({ grid, K: 2, shops: [shop('pharmacy', 3, 'mandatory'), shop('big', 8)] });
  const b = roster(i).body;
  assert.equal(b.status, 'ok', 'run of exactly K is allowed and the grid hour resets it');
  assert.equal(b.dark_hours.big, 4, 'dark_hours counts every dark outage hour, not the longest run');
  assert.deepEqual(checkRoster(i, b), []);
  // Without the grid hour (outage 12-15, four in a row) the same shop must break the rule: infeasible.
  const g2 = Array(10).fill(true); g2[2] = g2[3] = g2[4] = g2[5] = false;
  const j = market({ grid: g2, K: 2, shops: [shop('pharmacy', 3, 'mandatory'), shop('big', 8)] });
  const c = roster(j).body;
  assert.equal(c.status, 'infeasible');
  assert.equal(c.conflicts[0].rule, 'max_consecutive_dark');
  assert.ok(c.conflicts[0].shops.includes('big'));
  // Brute force agrees on both.
  assert.equal(brute(i).value, b.value_total);
  assert.equal(brute(j).feasible, false);
});

test('capacity: shops that fit together exactly at capacity are allowed; one kW more is not', () => {
  const grid = Array(10).fill(true); grid[0] = false;
  const ok = market({ grid, K: 0, shops: [shop('a', 6, 'mandatory'), shop('b', 4)] });
  assert.equal(roster(ok).body.status, 'ok');
  const over = market({ grid, K: 0, shops: [shop('a', 6, 'mandatory'), shop('b', 5)] });
  const r = roster(over).body;
  assert.equal(r.status, 'infeasible');
  const mand = market({ grid, shops: [shop('a', 6, 'mandatory'), shop('b', 5, 'mandatory')] });
  const m = roster(mand).body;
  assert.equal(m.status, 'infeasible');
  assert.equal(m.conflicts[0].rule, 'capacity');
  assert.deepEqual(m.conflicts[0].shops.sort(), ['a', 'b']);
});

test('checker catches duplicates, unknown ids and wrong dark_hours', () => {
  const body = roster(worked).body;
  const cases = {
    'id powered twice': (b) => { b.roster[0].powered.push(b.roster[0].powered[0]); },
    'unknown id': (b) => { b.roster[0].dark.push({ id: 'ghost', reason: 'x' }); },
    'shop missing from an hour': (b) => { const d = b.roster[0].dark.pop() || null; if (!d) b.roster[0].powered.pop(); },
    'wrong dark_hours': (b) => { const id = Object.keys(b.dark_hours).find((k) => k !== 'pharmacy'); b.dark_hours[id] += 1; },
    'mandatory dark_hours not zero': (b) => { b.dark_hours.pharmacy = 1; },
    'slot listed twice': (b) => { b.roster.push(clone(b.roster[0])); },
    'grid hour listed': (b) => { b.roster.push({ ...clone(b.roster[0]), slot: 0 }); },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const b = clone(body); mutate(b);
    assert.ok(checkRoster(worked, b).length > 0, `checker missed: ${name}`);
  }
});

test('more invalid inputs: missing fields, wrong types, bad litres, blank ids', () => {
  const bad = {
    'grid_available': (i) => { delete i.grid_available; },
    'fuel_budget_litres': (i) => { i.fuel_budget_litres = '8'; },
    'fuel_table': (i) => { i.fuel_table = []; },
    'max_consecutive_dark': (i) => { delete i.max_consecutive_dark; },
    'shops': (i) => { i.shops = {}; },
    'shops[0]': (i) => { i.shops[0] = 'pharmacy'; },
    'shops[0].id': (i) => { i.shops[0].id = '  '; },
    'shops[0].kw': (i) => { i.shops[0].kw = 2.5; },
    'shops[0].value_per_slot[2]': (i) => { i.shops[0].value_per_slot[2] = 1.5; },
    'fuel_table[1].litres_per_hour': (i) => { i.fuel_table[1].litres_per_hour = 1.234; },
    'fuel_table[0]': (i) => { i.fuel_table[0] = 4; },
    'generator_capacity_kw': (i) => { i.generator_capacity_kw = -10; },
    'body': () => [],
  };
  for (const [field, mutate] of Object.entries(bad)) {
    let i = clone(worked); const replaced = mutate(i); if (replaced !== undefined) i = replaced;
    const r = roster(i);
    assert.equal(r.httpStatus, 400, field);
    assert.equal(r.body.status, 'invalid_input', field);
    assert.equal(r.body.field, field, field);
  }
});

test('one server, many independent requests: no state carries over between requests', async () => {
  const server = await start(0);
  const base = `http://localhost:${server.address().port}/api/roster`;
  const post = async (b) => { const r = await fetch(base, { method: 'POST', body: JSON.stringify(b) }); return { code: r.status, text: await r.text() }; };
  try {
    const sample = read('inputs/sample_input.json');
    const first = await post(sample);
    const inf = clone(sample); inf.grid_available[6] = false;
    const steps = [await post(worked), await post({ nope: 1 }), await post(inf), await post(sample)];
    assert.deepEqual(steps.map((s) => s.code), [200, 400, 200, 200]);
    assert.equal(JSON.parse(steps[0].text).value_total, 84);
    assert.equal(JSON.parse(steps[2].text).status, 'infeasible');
    assert.equal(steps[3].text, first.text, 'the sample gives byte-identical output after other requests');
  } finally { server.close(); }
});
