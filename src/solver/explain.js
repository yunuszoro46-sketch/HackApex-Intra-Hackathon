'use strict';
// One true, one-line reason for every dark (shop, hour) in a roster.
// Method: imagine switching ONLY that shop on, everything else unchanged, and report which rule would break,
// with the real numbers. In a proven-optimal roster one of these always applies: if switching a shop on broke no
// rule and added value, the roster could not have been optimal.

const { slotLabel } = require('./model');
const L = (cents) => (cents / 100).toFixed(2);

// streak = how many outage hours in a row this shop has been dark, counting this one (grid hours reset it).
// It is appended to every reason so the reader can check the consecutive-dark rule (brief rule 5) directly.
function reasonFor(model, shop, slot, hourLoad, totalCents, optimal, bestEffort = false, streak = null) {
  const why = baseReason(model, shop, slot, hourLoad, totalCents, optimal, bestEffort);
  if (streak === null) return why;
  return `${why} Dark ${streak} hour${streak === 1 ? '' : 's'} in a row so far (limit ${model.maxDark}).`;
}

function baseReason(model, shop, slot, hourLoad, totalCents, optimal, bestEffort) {
  const t = slotLabel(slot);
  if (shop.kw > model.capacity) {
    return `Too big for the generator: needs ${shop.kw} kW, the generator carries ${model.capacity} kW. It can only run on grid power.`;
  }
  if (shop.kw > model.free) {
    return `Never fits: ${shop.kw} kW beside the ${model.mandatoryKw} kW of mandatory shops is more than the ${model.capacity} kW generator.`;
  }
  if (hourLoad + shop.kw > model.capacity) {
    return `Capacity: ${hourLoad} of ${model.capacity} kW already in use at ${t}; adding ${shop.kw} kW would make ${hourLoad + shop.kw} kW.`;
  }
  const before = model.fuelFor(hourLoad), after = model.fuelFor(hourLoad + shop.kw), extra = after - before;
  if (bestEffort) {
    // Least-diesel reference roster for an infeasible day: shops are dark only to save diesel.
    return `Least-diesel plan: switching it on would lift ${t} from ${hourLoad} to ${hourLoad + shop.kw} kW (${L(before)} -> ${L(after)} L/h); `
      + `even this plan needs ${L(totalCents)} L against the ${L(model.budget)} L budget.`;
  }
  if (totalCents + extra > model.budget) {
    return `Diesel: switching it on lifts ${t} from ${hourLoad} to ${hourLoad + shop.kw} kW (${L(before)} -> ${L(after)} L/h, +${L(extra)} L). `
      + `The plan uses ${L(totalCents)} of the ${L(model.budget)} L budget, leaving ${L(model.budget - totalCents)} L spare, `
      + `so the day would need ${L(totalCents + extra)} L; that diesel is spent in other hours of the plan.`;
  }
  const value = shop.values[slot];
  if (value === 0) return `No gain: worth 0 at ${t}, so switching it on adds nothing.`;
  // Only reachable when the time guard stopped the exact search (optimal === false).
  return optimal
    ? `Trade-off: worth ${value} at ${t}; switching it on breaks no rule by itself (see optimality note).`
    : `Not proven: switching it on breaks no rule by itself (worth ${value}); the search stopped at its time limit, so this roster may not be the best.`;
}

module.exports = { reasonFor };
