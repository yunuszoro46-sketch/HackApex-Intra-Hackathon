'use strict';
// The screen's form <-> request conversion (public/form.js). The form must produce exactly the request the API
// already takes, never repair or guess values, and leave every rule decision to the backend.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../public/form');
const { roster } = require('../src/solver/index');

const read = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const sample = read('inputs/sample_input.json');
const worked = read('tests/fixtures/worked_example_input.json');

test('round trip: sample and worked example come back from the form unchanged, and the API answer is byte-identical', () => {
  for (const input of [sample, worked]) {
    const { form } = F.requestToForm(input);
    const { request, errors } = F.formToRequest(form);
    assert.equal(errors, undefined);
    assert.deepEqual(request, input);
    assert.equal(JSON.stringify(roster(request).body), JSON.stringify(roster(input).body));
  }
});

test('the form keeps slot order and booleans: grid_available and every value_per_slot have 10 entries in hour order', () => {
  const { form } = F.requestToForm(sample);
  form.grid[6] = false;                                     // 16:00 becomes an outage
  form.shops[3].values[9] = '42';                           // photocopy at 19:00
  const { request } = F.formToRequest(form);
  assert.equal(request.grid_available.length, 10);
  assert.equal(request.grid_available[6], false);
  assert.ok(request.grid_available.every((g) => typeof g === 'boolean'));
  assert.equal(request.shops[3].value_per_slot[9], 42);
  assert.ok(request.shops.every((s) => s.value_per_slot.length === 10));
});

test('numbers: spaces around a number are fine; empty or non-numeric text is an error naming the field, nothing is guessed', () => {
  const { form } = F.requestToForm(sample);
  form.capacity = ' 20 ';
  assert.equal(F.formToRequest(form).request.generator_capacity_kw, 20);
  const cases = [
    ['capacity', '', 'generator_capacity_kw'],
    ['budget', '17 litres', 'fuel_budget_litres'],
    ['maxDark', 'two', 'max_consecutive_dark'],
  ];
  for (const [key, text, field] of cases) {
    const f = clone(form); f[key] = text;
    const r = F.formToRequest(f);
    assert.equal(r.request, undefined, key);
    assert.equal(r.errors[0].field, field);
  }
  const g = clone(form); g.fuel[1].litres = '2,0';
  assert.equal(F.formToRequest(g).errors[0].field, 'fuel_table[1].litres_per_hour');
  const h = clone(form); h.shops[2].values[4] = '';
  assert.equal(F.formToRequest(h).errors[0].field, 'shops[2].value_per_slot[4]');
});

test('rule checks stay with the server: negative, decimal and duplicate values are sent as typed and the API names the field', () => {
  const { form } = F.requestToForm(sample);
  const cases = [
    [(f) => { f.shops[2].kw = '2.5'; }, 'shops[2].kw'],
    [(f) => { f.budget = '-1'; }, 'fuel_budget_litres'],
    [(f) => { f.budget = '17.005'; }, 'fuel_budget_litres'],
    [(f) => { f.shops[3].id = f.shops[2].id; }, 'shops[3].id'],
    [(f) => { f.fuel[2].kw = '19'; }, 'fuel_table[2].load_kw'],
    [(f) => { f.maxDark = '1.5'; }, 'max_consecutive_dark'],
  ];
  for (const [mutate, field] of cases) {
    const f = clone(form); mutate(f);
    const r = F.formToRequest(f);
    assert.ok(r.request, `form must not block ${field}`);
    const api = roster(r.request);
    assert.equal(api.httpStatus, 400, field);
    assert.equal(api.body.field, field);
  }
});

test('shop ids: blank is an error; an id with spaces is sent exactly as typed, never trimmed', () => {
  const { form } = F.requestToForm(worked);
  const b = clone(form); b.shops[1].id = '   ';
  assert.equal(F.formToRequest(b).errors[0].field, 'shops[1].id');
  const s = clone(form); s.shops[1].id = ' tailor ';
  assert.equal(F.formToRequest(s).request.shops[1].id, ' tailor ');
  const t = clone(form); t.shops[1].type = 'vip';
  assert.equal(F.formToRequest(t).errors[0].field, 'shops[1].type');
});

test('adding and removing shops and fuel rows; the sample object is never changed by editing the form', () => {
  const before = JSON.stringify(sample);
  const { form } = F.requestToForm(sample);
  form.grid[0] = false; form.fuel.pop(); form.shops.splice(0, 1); form.shops[0].values[0] = '99';
  form.shops.push({ ...F.emptyShop(), id: 'new_shop', kw: '1', values: Array(10).fill('0') });
  assert.equal(JSON.stringify(sample), before, 'loading into the form must copy, not share, arrays');
  const { request } = F.formToRequest(form);
  assert.equal(request.shops.length, 12);
  assert.equal(request.shops[11].id, 'new_shop');
  assert.equal(request.fuel_table.length, 2);
  const none = clone(form); none.fuel = [];
  assert.equal(F.formToRequest(none).errors[0].field, 'fuel_table');
  const empty = F.formToRequest({ ...F.emptyForm(), capacity: '10', budget: '0', maxDark: '2', fuel: [{ kw: '10', litres: '1' }] });
  assert.deepEqual(empty.request.shops, []);
  assert.equal(roster(empty.request).body.status, 'ok', 'an empty shop list on an all-grid day is valid');
});

test('import refuses JSON the form cannot show, naming the field, instead of converting it', () => {
  const cases = [
    [(i) => { i.generator_capacity_kw = '20'; }, 'generator_capacity_kw'],
    [(i) => { i.grid_available.pop(); }, 'grid_available'],
    [(i) => { i.grid_available[2] = 'no'; }, 'grid_available'],
    [(i) => { i.shops[1].type = 'vip'; }, 'shops[1].type'],
    [(i) => { i.shops[1].value_per_slot = [1, 2]; }, 'shops[1].value_per_slot'],
    [(i) => { delete i.fuel_table; }, 'fuel_table'],
  ];
  for (const [mutate, field] of cases) {
    const i = clone(sample); mutate(i);
    assert.equal(F.requestToForm(i).error.field, field);
  }
  assert.equal(F.requestToForm([]).error.field, 'body');
});
