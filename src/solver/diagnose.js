'use strict';
// Why is there no roster? Called only when the exact search found none. Checks run from cheapest to most
// expensive and every message carries the real numbers (brief rule 5: say which rule and which shops/hours).

const { slotLabel } = require('./model');
const { solveMinFuel } = require('./solve');
const L = (cents) => (cents / 100).toFixed(2);
const span = (slots) => (slots.length ? `${slotLabel(slots[0])}-${slotLabel(slots[slots.length - 1] + 1)}` : '');

function diagnose(model) {
  const conflicts = [];
  const mandIds = model.mandatory.map((s) => s.id);

  // 1. The mandatory shops alone overload the generator.
  if (model.mandatoryKw > model.capacity) {
    conflicts.push({ rule: 'capacity', shops: mandIds, slots: model.outageSlots,
      detail: `Mandatory shops need ${model.mandatoryKw} kW together but the generator carries only ${model.capacity} kW, so they cannot all stay on in any outage hour.` });
    return { conflicts, bestEffort: null };
  }

  // 2. A normal shop that can never fit, inside an outage block longer than the dark-run limit.
  for (const s of model.neverFits) {
    for (const b of model.blocks.filter((bl) => bl.length > model.maxDark)) {
      conflicts.push({ rule: 'max_consecutive_dark', shops: [s.id], slots: b,
        detail: `${s.id} (${s.kw} kW) can never be powered beside ${model.mandatoryKw} kW of mandatory shops on a ${model.capacity} kW generator, so it would be dark ${b.length} hours in a row (${span(b)}); the limit is ${model.maxDark}.` });
    }
  }
  if (conflicts.length) return { conflicts, bestEffort: null };

  // 3. The mandatory shops alone burn more diesel than the budget.
  const mandFuel = model.outageSlots.length * model.fuelFor(model.mandatoryKw);
  if (mandFuel > model.budget) {
    conflicts.push({ rule: 'fuel', shops: mandIds, slots: model.outageSlots,
      detail: `The mandatory shops alone (${model.mandatoryKw} kW) burn ${L(mandFuel)} L over ${model.outageSlots.length} outage hours; the budget is ${L(model.budget)} L.` });
    return { conflicts, bestEffort: null };
  }

  // 4. Exact minimum diesel needed to respect capacity, mandatory shops and the dark-run rule.
  const min = solveMinFuel(model);
  if (min.feasible && min.fuelCents > model.budget) {
    conflicts.push({ rule: 'fuel', shops: model.eligible.map((s) => s.id), slots: model.outageSlots,
      detail: `No shop may be dark more than ${model.maxDark} hours in a row, and keeping to that needs at least ${L(min.fuelCents)} L of diesel (computed exactly over all ${model.outageSlots.length} outage hours); the budget is ${L(model.budget)} L, ${L(min.fuelCents - model.budget)} L short.` });
    return { conflicts, bestEffort: {
      label: `Best effort, NOT a valid roster: it keeps the capacity, mandatory and dark-run rules with the least diesel possible, but needs ${L(min.fuelCents)} L against the ${L(model.budget)} L budget.`,
      breaks: 'fuel', powered: min.powered } };
  }

  // 5. Capacity and the dark-run rule clash: at some hour the shops that must come on do not fit.
  if (!min.feasible && min.emptyAt != null && min.lastLayer) {
    let worst = null;
    for (const key of min.lastLayer.keys()) {
      const runs = min.enc.decode(key);
      const forced = model.eligible.filter((s, k) => runs[k] >= model.maxDark);
      const kw = forced.reduce((a, s) => a + s.kw, 0);
      if (!worst || kw < worst.kw) worst = { forced, kw };
    }
    conflicts.push({ rule: 'max_consecutive_dark', shops: worst.forced.map((s) => s.id), slots: [min.emptyAt],
      detail: `At ${slotLabel(min.emptyAt)} the shops already dark ${model.maxDark} hours in a row must come on, but whichever earlier hours are chosen they need at least ${worst.kw} kW beside ${model.mandatoryKw} kW of mandatory shops, more than the ${model.capacity} kW generator.` });
    return { conflicts, bestEffort: null };
  }

  conflicts.push({ rule: 'combined', shops: [], slots: model.outageSlots,
    detail: 'No roster satisfies capacity, the diesel budget, the mandatory shops and the dark-run rule together.' });
  return { conflicts, bestEffort: null };
}

module.exports = { diagnose };
