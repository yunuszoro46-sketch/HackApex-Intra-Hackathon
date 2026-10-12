'use strict';
// THE DECISION LOGIC. Exact optimiser for the generator roster.
//
// Idea in one paragraph: walk the outage hours in order. The only thing the past forces on the future is, for
// every normal shop, how many hours in a row it has been dark so far (its "dark run"), plus how much diesel is
// already spent. So the state is the vector of dark runs. For each state we keep every way of reaching it that is
// not beaten on both diesel and value (a Pareto list of (fuel used, value earned)). From a state, the allowed
// choices for the next hour are the sets of shops that (a) include every shop already dark for max_consecutive_dark
// hours, (b) fit the generator beside the mandatory shops. Fuel for the hour comes from the fuel table on the
// COMBINED load. A grid hour resets every run to zero. At the end the best value within the budget is the true
// optimum, because no way of running the day was ever thrown away unless another one was at least as good on
// value AND no worse on diesel from the very same state.
//
// Hour-by-hour greedy fails (the brief says so): it spends the diesel at noon and starves one shop until the
// three-hours rule breaks. This method plans the whole day at once.

const { buildModel } = require('./model');

// Precompute, for one outage hour, every subset of eligible normal shops: its load, value and fuel (combined load
// including the mandatory shops). Subsets that overload the generator are marked invalid.
function hourTable(model, slot) {
  const n = model.eligible.length, N = 1 << n;
  const load = new Int32Array(N), value = new Float64Array(N), fuel = new Float64Array(N), valid = new Uint8Array(N);
  for (let mask = 1; mask < N; mask++) {
    const k = 31 - Math.clz32(mask & -mask), rest = mask & (mask - 1), shop = model.eligible[k];
    load[mask] = load[rest] + shop.kw;
    value[mask] = value[rest] + shop.values[slot];
  }
  const mandValue = model.mandatory.reduce((a, s) => a + s.values[slot], 0);
  for (let mask = 0; mask < N; mask++) {
    valid[mask] = load[mask] <= model.free ? 1 : 0;
    value[mask] += mandValue;
    fuel[mask] = model.fuelFor(model.mandatoryKw + load[mask]);
    if (!Number.isFinite(fuel[mask])) valid[mask] = 0;
  }
  return { load, value, fuel, valid };
}

// Shared set-up: state encoding. If max_consecutive_dark is at least the longest outage block, the dark-run rule
// can never bind, so runs are not tracked at all (one state).
function encoding(model) {
  const n = model.eligible.length;
  const longest = model.blocks.reduce((a, b) => Math.max(a, b.length), 0);
  const track = model.maxDark < longest;
  const base = track ? model.maxDark + 1 : 1;
  const pow = []; for (let k = 0; k < n; k++) pow.push(base ** k);
  const decode = (key) => { const runs = new Array(n); for (let k = 0; k < n; k++) { runs[k] = track ? key % base : 0; key = track ? Math.floor(key / base) : 0; } return runs; };
  return { n, full: (1 << n) - 1, track, base, pow, decode, K: model.maxDark };
}

// Rules that make every roster impossible before any search is needed.
function obviousInfeasible(model) {
  if (model.mandatoryKw > model.capacity) return 'capacity';
  if (model.neverFits.length && model.blocks.some((b) => b.length > model.maxDark)) return 'never-fits';
  return null;
}

// Successor key: shops in `mask` reset to 0, every other shop's run grows by one.
function nextKey(enc, runs, mask) {
  if (!enc.track) return 0;
  let key = 0;
  for (let k = 0; k < enc.n; k++) if (!((mask >> k) & 1)) key += (runs[k] + 1) * enc.pow[k];
  return key;
}
function forcedMask(enc, runs) {
  if (!enc.track) return 0;
  let f = 0; for (let k = 0; k < enc.n; k++) if (runs[k] >= enc.K) f |= 1 << k;
  return f;
}

// Keep only labels not beaten on (fuel, value): sorted by fuel, each kept label has strictly more value.
// Sort is stable, so among exact ties the first one generated (deterministic order) is kept.
function pareto(list) {
  list.sort((a, b) => a.f - b.f || b.v - a.v);
  const out = []; let best = -Infinity;
  for (const l of list) if (l.v > best) { out.push(l); best = l.v; }
  return out;
}

// Maximise value within the diesel budget. Returns the roster or {feasible:false}.
function solveMaxValue(model, { timeLimitMs = 7000 } = {}) {
  const started = Date.now();
  if (obviousInfeasible(model)) return { feasible: false, optimal: true };
  const enc = encoding(model), B = model.budget;
  let layer = new Map([[0, [{ f: 0, v: 0, prev: null, mask: 0 }]]]);
  let optimal = true;
  model.outageSlots.forEach((slot, i) => {
    if (i > 0 && slot !== model.outageSlots[i - 1] + 1) {            // grid hour in between: all runs reset
      const all = []; for (const ls of layer.values()) all.push(...ls);
      layer = new Map([[0, pareto(all)]]);
    }
    const t = hourTable(model, slot), next = new Map();
    for (const [key, labels] of layer) {
      const runs = enc.decode(key), F = forcedMask(enc, runs), freeBits = enc.full & ~F;
      // every subset of the not-forced shops, joined with the forced ones (largest first: deterministic order)
      for (let sub = freeBits; ; sub = (sub - 1) & freeBits) {
        const mask = F | sub;
        if (t.valid[mask]) {
          const fu = t.fuel[mask], val = t.value[mask], nk = nextKey(enc, runs, mask);
          let bucket = next.get(nk);
          for (const l of labels) {
            if (l.f + fu > B) break;                                   // labels are sorted by fuel
            if (!bucket) { bucket = []; next.set(nk, bucket); }
            bucket.push({ f: l.f + fu, v: l.v + val, prev: l, mask });
          }
        }
        if (sub === 0) break;
      }
    }
    for (const [k, ls] of next) next.set(k, pareto(ls));
    // Time guard: if the exact search runs long, keep only the best-valued label per state from here on.
    // The answer is then still a valid roster, but it is labelled "optimality not proven".
    if (Date.now() - started > timeLimitMs) {
      optimal = false;
      for (const [k, ls] of next) next.set(k, [ls.reduce((a, b) => (b.v > a.v || (b.v === a.v && b.f < a.f) ? b : a))]);
    }
    layer = next;
  });
  let best = null;
  for (const ls of layer.values()) for (const l of ls) if (!best || l.v > best.v || (l.v === best.v && l.f < best.f)) best = l;
  if (!best) return { feasible: false, optimal };
  return { feasible: true, optimal, value: best.v, fuelCents: best.f, powered: rebuild(model, best), ms: Date.now() - started };
}

// Least diesel that satisfies capacity + mandatory + dark-run rules, ignoring the budget (used to explain an
// infeasible day: "the rules need at least X L, the budget is Y L"). Returns emptyAt = first outage slot at which
// no assignment fits at all (capacity and dark-run rule clash), if that happens.
function solveMinFuel(model) {
  if (model.mandatoryKw > model.capacity) return { feasible: false, emptyAt: model.outageSlots[0] };
  if (obviousInfeasible(model)) return { feasible: false, emptyAt: null };
  const enc = encoding(model);
  let layer = new Map([[0, { f: 0, v: 0, prev: null, mask: 0 }]]);
  for (let i = 0; i < model.outageSlots.length; i++) {
    const slot = model.outageSlots[i];
    if (i > 0 && slot !== model.outageSlots[i - 1] + 1) {
      let best = null; for (const l of layer.values()) if (!best || l.f < best.f || (l.f === best.f && l.v > best.v)) best = l;
      layer = new Map([[0, best]]);
    }
    const t = hourTable(model, slot), next = new Map();
    for (const [key, l] of layer) {
      const runs = enc.decode(key), F = forcedMask(enc, runs), freeBits = enc.full & ~F;
      for (let sub = freeBits; ; sub = (sub - 1) & freeBits) {
        const mask = F | sub;
        if (t.valid[mask]) {
          const nk = nextKey(enc, runs, mask), cand = { f: l.f + t.fuel[mask], v: l.v + t.value[mask], prev: l, mask };
          const cur = next.get(nk);
          if (!cur || cand.f < cur.f || (cand.f === cur.f && cand.v > cur.v)) next.set(nk, cand);
        }
        if (sub === 0) break;
      }
    }
    if (next.size === 0) return { feasible: false, emptyAt: slot, lastLayer: layer, enc };
    layer = next;
  }
  let best = null; for (const l of layer.values()) if (!best || l.f < best.f || (l.f === best.f && l.v > best.v)) best = l;
  return { feasible: true, fuelCents: best.f, value: best.v, powered: rebuild(model, best) };
}

// Walk the parent pointers back and list, for each outage slot, the ids of powered shops (mandatory + chosen).
function rebuild(model, label) {
  const masks = [];
  for (let l = label; l && l.prev; l = l.prev) masks.push(l.mask);
  masks.reverse();
  return model.outageSlots.map((slot, i) => {
    const ids = new Set(model.mandatory.map((s) => s.id));
    model.eligible.forEach((s, k) => { if ((masks[i] >> k) & 1) ids.add(s.id); });
    return ids;
  });
}

function solve(input, opts) { return solveMaxValue(buildModel(input), opts); }

module.exports = { solve, solveMaxValue, solveMinFuel, hourTable, obviousInfeasible };
