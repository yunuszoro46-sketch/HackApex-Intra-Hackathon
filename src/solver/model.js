'use strict';
// Turns a VALIDATED input into the numbers the solver works with.
// All diesel is kept in whole hundredths of a litre ("cents") so budget comparisons are exact (brief rule 4).

const SLOTS = 10;                                   // slot 0 = 10:00 ... slot 9 = 19:00 (brief rule 1)
const toCents = (litres) => Math.round(litres * 100);
const slotLabel = (slot) => `${String(10 + slot).padStart(2, '0')}:00`;

// Fuel for one hour: find the first level whose load_kw is >= the combined load and charge its litres.
// Zero load costs zero. A load above the last level (= capacity) is impossible and returns Infinity.
function makeFuelFor(levels) {
  return function fuelFor(kw) {
    if (kw <= 0) return 0;
    for (const lv of levels) if (lv.kw >= kw) return lv.cents;
    return Infinity;
  };
}

function buildModel(input) {
  const capacity = input.generator_capacity_kw;
  const levels = input.fuel_table.map((l) => ({ kw: l.load_kw, cents: toCents(l.litres_per_hour) }));
  const fuelFor = makeFuelFor(levels);
  const shops = input.shops.map((s, index) => ({ id: s.id, kw: s.kw, type: s.type, values: s.value_per_slot, index }));
  const mandatory = shops.filter((s) => s.type === 'mandatory');
  const normal = shops.filter((s) => s.type === 'normal');
  const mandatoryKw = mandatory.reduce((a, s) => a + s.kw, 0);
  const free = capacity - mandatoryKw;              // kW left for normal shops once every mandatory shop is on
  // A normal shop that cannot fit beside the mandatory load can never be on in an outage hour.
  const eligible = normal.filter((s) => s.kw <= free);
  const neverFits = normal.filter((s) => s.kw > free);

  const outageSlots = [];
  for (let h = 0; h < SLOTS; h++) if (!input.grid_available[h]) outageSlots.push(h);
  // Blocks of consecutive outage hours. A grid hour between two outages resets every dark run (brief rule 6).
  const blocks = [];
  for (const h of outageSlots) {
    const last = blocks[blocks.length - 1];
    if (last && last[last.length - 1] === h - 1) last.push(h); else blocks.push([h]);
  }
  const mandatoryValue = outageSlots.map((h) => mandatory.reduce((a, s) => a + s.values[h], 0));

  return {
    capacity, levels, fuelFor, budget: toCents(input.fuel_budget_litres), maxDark: input.max_consecutive_dark,
    shops, mandatory, normal, eligible, neverFits, mandatoryKw, free, outageSlots, blocks, mandatoryValue,
  };
}

module.exports = { buildModel, makeFuelFor, toCents, slotLabel, SLOTS };
