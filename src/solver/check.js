'use strict';
// Independent rule checker. Re-derives every rule straight from the raw input and the response body.
// It deliberately imports NOTHING from the solver, so a solver bug cannot hide itself here.
// It is our own implementation of the brief's rules, NOT the official validator (which was not supplied).
// Returns a list of violations (empty = the roster obeys every rule and its totals are right).

function cents(x) { return Math.round(x * 100); }

function checkRoster(input, body) {
  const v = [];
  const cap = input.generator_capacity_kw, budget = cents(input.fuel_budget_litres), K = input.max_consecutive_dark;
  const table = input.fuel_table.map((l) => [l.load_kw, cents(l.litres_per_hour)]);
  const fuelOf = (kw) => { if (kw === 0) return 0; const lv = table.find(([k]) => k >= kw); return lv ? lv[1] : Infinity; };
  const shops = new Map(input.shops.map((s) => [s.id, s]));
  const allIds = input.shops.map((s) => s.id);
  const outage = []; input.grid_available.forEach((g, h) => { if (!g) outage.push(h); });

  if (!Array.isArray(body.roster)) return ['roster is not a list'];
  const bySlot = new Map();
  for (const r of body.roster) {
    if (bySlot.has(r.slot)) v.push(`slot ${r.slot} appears twice`);
    bySlot.set(r.slot, r);
    if (!outage.includes(r.slot)) v.push(`slot ${r.slot} is not an outage hour`);
  }
  for (const h of outage) if (!bySlot.has(h)) v.push(`outage slot ${h} is missing`);

  let fuelTotal = 0, value = 0;
  const run = new Map(allIds.map((id) => [id, 0])), darkCount = new Map(allIds.map((id) => [id, 0]));
  for (let h = 0; h < 10; h++) {
    const r = bySlot.get(h);
    if (input.grid_available[h] || !r) { for (const id of allIds) run.set(id, 0); continue; }   // grid hour resets runs
    const powered = r.powered || [], dark = (r.dark || []).map((d) => d.id);
    const listed = [...powered, ...dark];
    if (new Set(listed).size !== listed.length) v.push(`slot ${h}: an id is repeated or both powered and dark`);
    for (const id of allIds) if (!listed.includes(id)) v.push(`slot ${h}: ${id} is neither powered nor dark`);
    for (const id of listed) if (!shops.has(id)) v.push(`slot ${h}: unknown id ${id}`);
    for (const d of r.dark || []) if (typeof d.reason !== 'string' || d.reason.trim() === '') v.push(`slot ${h}: dark ${d.id} has no reason`);
    let load = 0;
    for (const id of powered) { const s = shops.get(id); if (s) { load += s.kw; value += s.value_per_slot[h]; } }
    if (load > cap) v.push(`slot ${h}: load ${load} kW exceeds capacity ${cap} kW`);
    const f = fuelOf(load); fuelTotal += f;
    if (r.load_kw !== undefined && r.load_kw !== load) v.push(`slot ${h}: load_kw ${r.load_kw} but powered shops add to ${load}`);
    if (r.fuel_litres !== undefined && cents(r.fuel_litres) !== f) v.push(`slot ${h}: fuel_litres ${r.fuel_litres} but the fuel table gives ${f / 100}`);
    for (const s of input.shops) {
      const on = powered.includes(s.id);
      if (s.type === 'mandatory' && !on) v.push(`slot ${h}: mandatory shop ${s.id} is dark`);
      if (on) run.set(s.id, 0);
      else { run.set(s.id, run.get(s.id) + 1); darkCount.set(s.id, darkCount.get(s.id) + 1);
        if (s.type === 'normal' && run.get(s.id) > K) v.push(`slot ${h}: ${s.id} dark ${run.get(s.id)} hours in a row (limit ${K})`); }
    }
  }
  if (fuelTotal > budget) v.push(`total fuel ${fuelTotal / 100} L exceeds budget ${budget / 100} L`);
  if (cents(body.fuel_total_litres) !== fuelTotal) v.push(`fuel_total_litres ${body.fuel_total_litres} but roster burns ${fuelTotal / 100}`);
  if (body.value_total !== value) v.push(`value_total ${body.value_total} but roster is worth ${value}`);
  for (const id of allIds) {
    const want = shops.get(id).type === 'mandatory' ? 0 : darkCount.get(id);
    if (!body.dark_hours || body.dark_hours[id] !== want) v.push(`dark_hours.${id} should be ${want}`);
  }
  return v;
}

module.exports = { checkRoster };
