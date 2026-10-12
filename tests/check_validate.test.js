'use strict';
// The independent checker against the brief's PUBLISHED worked-example roster (PDF p.4) and broken copies of it,
// plus input validation (brief rules 2, 4, 9): every invalid case must name its field.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkRoster } = require('../src/solver/check');
const { roster } = require('../src/solver/index');

const input = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/worked_example_input.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// Roster table from page 4 of the problem statement (✓ = powered). Slots 2,3,4 = 12:00-14:00, 7,8,9 = 17:00-19:00.
const ON = {
  2: ['pharmacy', 'mobile', 'photocopy', 'tea_stall'],
  3: ['pharmacy', 'tailor', 'photocopy', 'tea_stall'],
  4: ['pharmacy', 'tea_stall'],
  7: ['pharmacy', 'tailor', 'photocopy', 'tea_stall'],
  8: ['pharmacy', 'mobile', 'tea_stall'],
  9: ['pharmacy', 'mobile', 'tea_stall'],
};
function published() {
  const ids = input.shops.map((s) => s.id);
  const dark_hours = Object.fromEntries(ids.map((id) => [id, 0]));
  const roster = Object.entries(ON).map(([slot, on]) => {
    const dark = ids.filter((id) => !on.includes(id));
    dark.forEach((id) => { dark_hours[id] += 1; });
    return { slot: Number(slot), powered: [...on], dark: dark.map((id) => ({ id, reason: 'published example' })) };
  });
  return { status: 'ok', roster, value_total: 84, fuel_total_litres: 8.0, dark_hours };
}

test('checker accepts the brief\'s published worked-example roster (84, 8.00 L)', () => {
  assert.deepEqual(checkRoster(input, published()), []);
});

test('checker catches every kind of broken roster', () => {
  const cases = {
    'over capacity': (b) => { b.roster[0].powered.push('tailor'); b.roster[0].dark = b.roster[0].dark.filter((d) => d.id !== 'tailor'); },
    'mandatory dark': (b) => { b.roster[2].powered = b.roster[2].powered.filter((id) => id !== 'pharmacy'); b.roster[2].dark.push({ id: 'pharmacy', reason: 'x' }); },
    'three dark in a row': (b) => { b.roster[0].powered = b.roster[0].powered.filter((id) => id !== 'tea_stall'); b.roster[0].dark.push({ id: 'tea_stall', reason: 'x' });
      b.roster[1].powered = b.roster[1].powered.filter((id) => id !== 'tea_stall'); b.roster[1].dark.push({ id: 'tea_stall', reason: 'x' });
      b.roster[2].powered = b.roster[2].powered.filter((id) => id !== 'tea_stall'); b.roster[2].dark.push({ id: 'tea_stall', reason: 'x' }); },
    'id both powered and dark': (b) => { b.roster[0].dark.push({ id: 'pharmacy', reason: 'x' }); },
    'missing slot': (b) => { b.roster.pop(); },
    'wrong value_total': (b) => { b.value_total = 85; },
    'wrong fuel total': (b) => { b.fuel_total_litres = 8.01; },
    'dark without reason': (b) => { b.roster[0].dark[0].reason = ''; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const b = published(); mutate(b);
    assert.ok(checkRoster(input, b).length > 0, `not caught: ${name}`);
  }
});

test('checker catches fuel over budget even when totals are self-consistent', () => {
  const tight = clone(input); tight.fuel_budget_litres = 7.99;
  assert.ok(checkRoster(tight, published()).some((v) => /exceeds budget/.test(v)));
});

test('invalid inputs return HTTP 400 invalid_input naming the field', () => {
  const bad = {
    'grid_available': (i) => { i.grid_available.pop(); },
    'grid_available[3]': (i) => { i.grid_available[3] = 'no'; },
    'generator_capacity_kw': (i) => { delete i.generator_capacity_kw; },
    'fuel_budget_litres': (i) => { i.fuel_budget_litres = 8.005; },
    'fuel_table[1].load_kw': (i) => { i.fuel_table[1].load_kw = 3; },
    'fuel_table[2].load_kw': (i) => { i.fuel_table[2].load_kw = 9; },
    'fuel_table[0].litres_per_hour': (i) => { i.fuel_table[0].litres_per_hour = -1; },
    'max_consecutive_dark': (i) => { i.max_consecutive_dark = 1.5; },
    'shops[1].id': (i) => { i.shops[1].id = 'pharmacy'; },
    'shops[2].kw': (i) => { i.shops[2].kw = 0; },
    'shops[3].type': (i) => { i.shops[3].type = 'vip'; },
    'shops[0].value_per_slot': (i) => { i.shops[0].value_per_slot.push(1); },
    'shops[4].value_per_slot[0]': (i) => { i.shops[4].value_per_slot[0] = -2; },
    'shops': (i) => { while (i.shops.length < 13) i.shops.push({ ...clone(i.shops[1]), id: `extra${i.shops.length}` }); },
  };
  for (const [field, mutate] of Object.entries(bad)) {
    const i = clone(input); mutate(i);
    const r = roster(i);
    assert.equal(r.httpStatus, 400, field);
    assert.equal(r.body.status, 'invalid_input', field);
    assert.equal(r.body.field, field);
  }
});

test('valid edge inputs are accepted: extra fields like _story, empty shops, all grid', () => {
  const i = clone(input); i._story = 'free text'; assert.equal(roster(i).httpStatus, 200);
  const e = clone(input); e.shops = []; assert.equal(roster(e).body.status, 'ok');
  const g = clone(input); g.grid_available = Array(10).fill(true); assert.equal(roster(g).body.status, 'ok');
});
