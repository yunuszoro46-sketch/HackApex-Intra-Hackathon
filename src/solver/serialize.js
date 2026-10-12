'use strict';
// Builds the response JSON from a solved roster. This is the ONLY file that knows the output field names, so it is
// the only file to change if the official schema.md differs (it was not supplied; see KNOWN_ISSUES.md).

const { slotLabel } = require('./model');
const { reasonFor } = require('./explain');
const litres = (cents) => Number((cents / 100).toFixed(2));

// powered: array (one entry per outage slot) of Set(shop ids). Totals are recomputed from the roster itself.
function rosterBody(model, powered, optimal) {
  let running = 0, valueTotal = 0;
  const dark = Object.fromEntries(model.shops.map((s) => [s.id, 0]));
  const hours = model.outageSlots.map((slot, i) => {
    const on = model.shops.filter((s) => powered[i].has(s.id));
    const load = on.reduce((a, s) => a + s.kw, 0), fuel = model.fuelFor(load);
    running += fuel;
    valueTotal += on.reduce((a, s) => a + s.values[slot], 0);
    return { slot, on, load, fuel, running };
  });
  const roster = hours.map(({ slot, on, load, fuel, running: run }) => ({
    slot,
    time: slotLabel(slot),
    powered: on.map((s) => s.id),
    dark: model.shops.filter((s) => !on.includes(s)).map((s) => {
      dark[s.id] += 1;
      return { id: s.id, reason: reasonFor(model, s, slot, load, running, optimal) };
    }),
    load_kw: load,
    fuel_litres: litres(fuel),
    fuel_running_litres: litres(run),
  }));
  return {
    roster,
    value_total: valueTotal,
    fuel_total_litres: litres(running),
    dark_hours: dark,
    capacity_kw: model.capacity,
    fuel_budget_litres: litres(model.budget),
  };
}

function okBody(model, result) {
  return { status: 'ok', ...rosterBody(model, result.powered, result.optimal), optimal: result.optimal };
}

function infeasibleBody(model, conflicts, bestEffort) {
  const body = {
    status: 'infeasible',
    message: conflicts.map((c) => c.detail).join(' '),
    conflicts,
    roster: [],
    best_effort: null,
  };
  if (bestEffort) {
    body.best_effort = {
      label: bestEffort.label,
      breaks: bestEffort.breaks,
      ...rosterBody(model, bestEffort.powered, true),
    };
  }
  return body;
}

module.exports = { okBody, infeasibleBody, rosterBody, litres };
