'use strict';
// End-to-end through HTTP: status codes, boundary cases and adversarial inputs, against the real server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../src/server');
const { checkRoster } = require('../src/solver/check');

const read = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
let server, base;
test.before(async () => { server = await start(0); base = `http://localhost:${server.address().port}`; });
test.after(() => server.close());

async function post(body) {
  const t = Date.now();
  const res = await fetch(`${base}/api/roster`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const json = await res.json();
  assert.ok(Date.now() - t < 10000, 'answered in under 10 s');
  return { code: res.status, body: json };
}

test('sample: 200 ok, value 186, checker-clean', async () => {
  const input = read('inputs/sample_input.json');
  const r = await post(input);
  assert.equal(r.code, 200); assert.equal(r.body.status, 'ok'); assert.equal(r.body.value_total, 186);
  assert.deepEqual(checkRoster(input, r.body), []);
});

test('not JSON: 400 invalid_input naming the body', async () => {
  const r = await post('{');
  assert.equal(r.code, 400); assert.equal(r.body.status, 'invalid_input'); assert.equal(r.body.field, 'body');
});

test('boundary: budget exactly the minimum needed (17.60 L) is ok and uses every hundredth; 17.59 L is infeasible', async () => {
  const exact = read('evidence/boundary/input_budget_exact.json');
  const ok = await post(exact);
  assert.equal(ok.body.status, 'ok'); assert.equal(ok.body.fuel_total_litres, 17.6);
  assert.deepEqual(checkRoster(exact, ok.body), []);
  const short = await post(read('evidence/boundary/input_budget_one_hundredth_short.json'));
  assert.equal(short.code, 200); assert.equal(short.body.status, 'infeasible');
  assert.match(short.body.conflicts[0].detail, /17\.60 L.*17\.59 L/);
});

test('mandatory shops over capacity: infeasible, rule capacity, names them', async () => {
  const i = read('tests/fixtures/worked_example_input.json'); i.shops[0].kw = 11; i.generator_capacity_kw = 10;
  const r = await post(i);
  assert.equal(r.body.status, 'infeasible'); assert.equal(r.body.conflicts[0].rule, 'capacity'); assert.deepEqual(r.body.conflicts[0].shops, ['pharmacy']);
});

test('mandatory shops alone burn more than the budget: infeasible, rule fuel', async () => {
  const i = read('tests/fixtures/worked_example_input.json'); i.fuel_budget_litres = 4.79;   // 6 hours x 0.80 L = 4.80 L
  const r = await post(i);
  assert.equal(r.body.status, 'infeasible'); assert.equal(r.body.conflicts[0].rule, 'fuel'); assert.match(r.body.conflicts[0].detail, /4\.80 L/);
});

test('shop bigger than the generator: infeasible when an outage block exceeds the dark limit, ok when blocks are short', async () => {
  const i = read('tests/fixtures/worked_example_input.json'); i.shops[1].kw = 11;          // tailor 11 kW on a 10 kW generator
  const r = await post(i);
  assert.equal(r.body.status, 'infeasible'); assert.equal(r.body.conflicts[0].rule, 'max_consecutive_dark'); assert.deepEqual(r.body.conflicts[0].shops, ['tailor']);
  i.grid_available = [true, true, false, false, true, true, true, false, false, true];      // blocks of 2 hours only
  const ok = await post(i);
  assert.equal(ok.body.status, 'ok'); assert.deepEqual(checkRoster(i, ok.body), []);
  assert.match(ok.body.roster[0].dark.find((d) => d.id === 'tailor').reason, /Too big/);
});

test('max_consecutive_dark 0: every shop on every outage hour, or infeasible when they cannot all fit', async () => {
  const i = read('tests/fixtures/worked_example_input.json'); i.max_consecutive_dark = 0;  // 13 kW on a 10 kW generator
  const r = await post(i);
  assert.equal(r.body.status, 'infeasible'); assert.equal(r.body.conflicts[0].rule, 'max_consecutive_dark');
  i.generator_capacity_kw = 13; i.fuel_table[2].load_kw = 13; i.fuel_budget_litres = 99;
  const ok = await post(i);
  assert.equal(ok.body.status, 'ok'); assert.ok(ok.body.roster.every((h) => h.dark.length === 0));
});

test('large dark limit (10): rule never binds, result checker-clean', async () => {
  const i = read('inputs/sample_input.json'); i.max_consecutive_dark = 10;
  const r = await post(i);
  assert.equal(r.body.status, 'ok'); assert.ok(r.body.value_total >= 186); assert.deepEqual(checkRoster(i, r.body), []);
});

test('regression input (all hours out, 12 small shops) answers optimally instead of crashing', async () => {
  const i = read('evidence/regression/input_all_outage_small_shops.json');
  const r = await post(i);
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.optimal, true); assert.deepEqual(checkRoster(i, r.body), []);
});

test('regression (fuzz case 77): a feasible day is answered ok and proven optimal in under 10 s, not "infeasible" after 21 s', async () => {
  const i = read('evidence/regression_timeout/input_fuzz_case77.json');
  const r = await post(i);   // post() asserts the 10 s limit
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.optimal, true); assert.deepEqual(checkRoster(i, r.body), []);
});

test('adversarial inputs get 400 with the field named', async () => {
  const s = read('inputs/sample_input.json');
  const cases = [
    [(i) => { i.fuel_budget_litres = '17'; }, 'fuel_budget_litres'],
    [(i) => { i.shops[0].value_per_slot[2] = 1.5; }, 'shops[0].value_per_slot[2]'],
    [(i) => { i.fuel_table.reverse(); }, 'fuel_table[1].load_kw'],
    [(i) => { i.shops = 'none'; }, 'shops'],
    [(i) => { i.grid_available = null; }, 'grid_available'],
  ];
  for (const [mutate, field] of cases) { const i = clone(s); mutate(i); const r = await post(i); assert.equal(r.code, 400, field); assert.equal(r.body.field, field); }
  const arr = await post([1, 2]); assert.equal(arr.code, 400); assert.equal(arr.body.field, 'body');
});

test('wrong method and unknown path', async () => {
  assert.equal((await fetch(`${base}/api/roster`)).status, 405);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});
