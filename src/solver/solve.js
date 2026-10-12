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
  const load = new Int32Array(N), value = new Float64Array(N), fuel = new Float64Array(N), valid = new Uint8Array(N), maximal = new Uint8Array(N);
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
  // A set of shops is "full for its fuel level" when no other shop could be added without moving the hour to a
  // dearer fuel level (or over capacity). Adding a shop that fits costs no diesel, never lowers value (values are
  // >= 0) and resets that shop's dark run, which can only help later hours. So some optimal roster uses only such
  // full sets, and the search only needs to try those. This is what keeps the search small on big inputs.
  const levelKw = (kw) => { if (kw <= 0) return 0; for (const lv of model.levels) if (lv.kw >= kw) return lv.kw; return -1; };
  for (let mask = 0; mask < N; mask++) {
    if (!valid[mask]) continue;
    const total = model.mandatoryKw + load[mask], room = Math.min(levelKw(total), model.capacity) - total;
    let full = 1;
    for (let k = 0; k < n && full; k++) if (!((mask >> k) & 1) && model.eligible[k].kw <= room) full = 0;
    maximal[mask] = full;
  }
  return { load, value, fuel, valid, maximal };
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

// Optimistic bound used to skip hopeless branches. For every remaining outage hour take the best value any allowed
// set of shops could earn at each fuel cost, IGNORING the dark-run rule, and share the remaining diesel between
// those hours (a small knapsack over diesel in hundredths). Ignoring a rule can only over-estimate, so the bound
// never cuts off the true optimum. ub[i][b] = most value hours i..end can still earn with b hundredths of diesel.
function upperBounds(model, tables, budgetCap) {
  const T = tables.length, ub = [];
  ub[T] = new Float64Array(budgetCap + 1);                     // nothing left to earn
  for (let i = T - 1; i >= 0; i--) {
    const byFuel = new Map(), t = tables[i];
    for (let m = 0; m < t.valid.length; m++) if (t.valid[m] && !(byFuel.get(t.fuel[m]) >= t.value[m])) byFuel.set(t.fuel[m], t.value[m]);
    const row = new Float64Array(budgetCap + 1).fill(-Infinity), nextRow = ub[i + 1];
    for (let b = 0; b <= budgetCap; b++) {
      for (const [c, v] of byFuel) if (c <= b && nextRow[b - c] + v > row[b]) row[b] = nextRow[b - c] + v;
    }
    ub[i] = row;
  }
  return ub;
}

// One pass of the layered search. beamWidth = 0 means exact (keep every non-dominated label, prune only with the
// bound against a known feasible value `floor`). beamWidth > 0 keeps only the most promising labels per hour: fast,
// used to find a good feasible roster first; its result is never called optimal on its own.
function layeredSearch(model, ctx, { beamWidth = 0, floor = -Infinity, deadline = Infinity, maxLabels = Infinity } = {}) {
  const { enc, tables, ub, B, cap } = ctx;
  let layer = new Map([[0, [{ f: 0, v: 0, prev: null, mask: 0 }]]]);
  for (let i = 0; i < model.outageSlots.length; i++) {
    const slot = model.outageSlots[i];
    if (i > 0 && slot !== model.outageSlots[i - 1] + 1) {          // grid hour in between: all runs reset
      const all = []; for (const ls of layer.values()) all.push(...ls);
      layer = new Map([[0, pareto(all)]]);
    }
    const t = tables[i], nextUb = ub[i + 1], next = new Map();
    let count = 0;
    for (const [key, labels] of layer) {
      const runs = enc.decode(key), F = forcedMask(enc, runs), freeBits = enc.full & ~F;
      for (let sub = freeBits; ; sub = (sub - 1) & freeBits) {
        const mask = F | sub;
        if (t.valid[mask] && t.maximal[mask]) {
          const fu = t.fuel[mask], val = t.value[mask];
          let nk = -1, bucket = null;
          for (const l of labels) {
            const nf = l.f + fu;
            if (nf > B) break;                                        // labels are sorted by fuel
            const nv = l.v + val;
            if (nv + nextUb[Math.min(cap, B) - nf] < floor) continue;  // cannot beat a roster we already have
            if (nk < 0) { nk = nextKey(enc, runs, mask); bucket = next.get(nk); if (!bucket) { bucket = []; next.set(nk, bucket); } }
            bucket.push({ f: nf, v: nv, prev: l, mask });
            if (++count > maxLabels || (count % 50000 === 0 && Date.now() > deadline)) return { aborted: true };
          }
        }
        if (sub === 0) break;
      }
    }
    for (const [k, ls] of next) next.set(k, pareto(ls));
    if (beamWidth > 0) layer = keepBest(next, beamWidth, nextUb, Math.min(cap, B));
    else layer = next;
    if (Date.now() > deadline) return { aborted: true };
  }
  let best = null;
  for (const ls of layer.values()) for (const l of ls) if (!best || l.v > best.v || (l.v === best.v && l.f < best.f)) best = l;
  return { aborted: false, best };
}

// Beam: keep the `width` labels with the highest value + optimistic remaining value (deterministic tie order).
function keepBest(layer, width, ubRow, b) {
  const all = [];
  for (const [k, ls] of layer) for (const l of ls) all.push([k, l, l.v + ubRow[b - l.f]]);
  if (all.length <= width) return layer;
  all.sort((x, y) => y[2] - x[2] || y[1].v - x[1].v || x[1].f - y[1].f || x[0] - y[0]);
  const out = new Map();
  for (const [k, l] of all.slice(0, width)) { if (!out.has(k)) out.set(k, []); out.get(k).push(l); }
  for (const [k, ls] of out) out.set(k, pareto(ls));
  return out;
}

// Maximise value within the diesel budget.
//  1. A quick beam pass finds a good feasible roster (a floor).
//  2. The exact pass keeps every non-dominated label but skips any whose value + optimistic bound is below the floor.
//     If it completes, the answer is proven optimal (and "no roster" is proven infeasible).
//  3. Safety net: if the exact pass would exceed its memory or time allowance, the best roster found so far is
//     returned with optimal: false, so the server always answers (it never runs out of memory).
function solveMaxValue(model, { timeLimitMs = 6000, maxLabels = 2500000 } = {}) {
  const started = Date.now();
  if (obviousInfeasible(model)) return { feasible: false, optimal: true };
  const enc = encoding(model);
  const tables = model.outageSlots.map((slot) => hourTable(model, slot));
  const maxHour = tables.reduce((a, t) => { let m = 0; for (let k = 0; k < t.valid.length; k++) if (t.valid[k] && t.fuel[k] > m) m = t.fuel[k]; return a + m; }, 0);
  const cap = Math.min(model.budget, maxHour);                    // diesel beyond this can never be spent
  const ctx = { enc, tables, ub: upperBounds(model, tables, cap), B: model.budget, cap };
  const deadline = started + timeLimitMs;

  // A quick beam pass first: cheap, and on almost every input it finds a valid roster within a fraction of a second.
  // (Fix for evidence/regression_timeout: before, the least-diesel search ran first, overran its deadline, and the
  // beam then had no time left, so a feasible day was answered "infeasible, not proven" after 21 s.)
  const quick = layeredSearch(model, ctx, { beamWidth: 300, deadline });
  // The least-diesel roster that keeps every other rule: if even it is over budget, no roster exists (proven,
  // and its figure explains why). Otherwise it is a valid roster and a first floor for the search.
  // If the beam found nothing, the day may well be infeasible, and the least-diesel search is what proves it, so it
  // gets the whole allowance; otherwise half, leaving time for the exact pass.
  // When the beam already found a valid roster the day is feasible and this search is skipped (more time for the
  // exact pass). Otherwise it runs with the budget as a cut-off: any partial plan that cannot finish within the
  // budget is dropped, which proves "infeasible" far faster than computing the exact minimum. The exact minimum is
  // then computed for the explanation only if time allows.
  let minFuel = { aborted: true, skipped: true };
  if (!quick.best) {
    minFuel = solveMinFuel(model, { deadline: started + timeLimitMs, cutoff: model.budget });
    if (minFuel.overBudget) {
      const exactMin = solveMinFuel(model, { deadline: Math.min(started + timeLimitMs, Date.now() + 3000) });
      return { feasible: false, optimal: true, minFuel: exactMin.aborted ? minFuel : exactMin };
    }
    if (!minFuel.aborted && !minFuel.feasible) return { feasible: false, optimal: true, minFuel };
  }
  const floor = Math.max(quick.best ? quick.best.v : -Infinity, minFuel.feasible ? minFuel.value : -Infinity);
  const exact = layeredSearch(model, ctx, { floor, deadline, maxLabels });
  let best, optimal;
  if (!exact.aborted) { best = exact.best; optimal = true; }
  else {
    const wide = layeredSearch(model, ctx, { beamWidth: 5000, deadline: started + timeLimitMs + 700 });
    best = [quick.best, wide.aborted ? null : wide.best].filter(Boolean).sort((a, b) => b.v - a.v || a.f - b.f)[0] || null;
    optimal = false;
  }
  if (!best && minFuel.feasible && minFuel.fuelCents <= model.budget) {
    return { feasible: true, optimal: false, value: minFuel.value, fuelCents: minFuel.fuelCents, powered: minFuel.powered, ms: Date.now() - started };
  }
  if (!best) return { feasible: false, optimal, searchIncomplete: !optimal, minFuel };
  return { feasible: true, optimal, value: best.v, fuelCents: best.f, powered: rebuild(model, best), ms: Date.now() - started };
}

// Least diesel that satisfies capacity + mandatory + dark-run rules, ignoring the budget (used to explain an
// infeasible day: "the rules need at least X L, the budget is Y L"). Returns emptyAt = first outage slot at which
// no assignment fits at all (capacity and dark-run rule clash), if that happens.
// cutoff (optional, in hundredths): drop partial plans whose diesel plus the least possible diesel of the remaining
// hours exceeds it. If that empties a layer, the answer is { feasible: false, overBudget: true } = no plan within it.
function solveMinFuel(model, { deadline = Infinity, cutoff = Infinity } = {}) {
  if (model.mandatoryKw > model.capacity) return { feasible: false, emptyAt: model.outageSlots[0] };
  if (obviousInfeasible(model)) return { feasible: false, emptyAt: null };
  const enc = encoding(model);
  let layer = new Map([[0, { f: 0, v: 0, prev: null, mask: 0 }]]), count = 0;
  // lbRest[i] = least diesel hours i.. can possibly burn (cheapest allowed set each hour, ignoring the dark-run rule).
  const hourMin = model.outageSlots.map((slot) => { const t = hourTable(model, slot); let m = Infinity; for (let k = 0; k < t.valid.length; k++) if (t.valid[k] && t.fuel[k] < m) m = t.fuel[k]; return m; });
  const lbRest = Array(hourMin.length + 1).fill(0);
  for (let i = hourMin.length - 1; i >= 0; i--) lbRest[i] = lbRest[i + 1] + hourMin[i];
  let cutHit = false;
  for (let i = 0; i < model.outageSlots.length; i++) {
    const slot = model.outageSlots[i];
    if (i > 0 && slot !== model.outageSlots[i - 1] + 1) {
      let best = null; for (const l of layer.values()) if (!best || l.f < best.f || (l.f === best.f && l.v > best.v)) best = l;
      layer = new Map([[0, best]]);
    }
    const t = hourTable(model, slot), next = new Map();
    if (Date.now() > deadline) return { feasible: false, aborted: true };
    for (const [key, l] of layer) {
      const runs = enc.decode(key), F = forcedMask(enc, runs), freeBits = enc.full & ~F;
      for (let sub = freeBits; ; sub = (sub - 1) & freeBits) {
        const mask = F | sub;
        // Deadline checked inside the layer too: one layer alone can be huge (see evidence/regression_timeout).
        if (++count % 20000 === 0 && Date.now() > deadline) return { feasible: false, aborted: true };
        if (t.valid[mask] && t.maximal[mask]) {
          if (l.f + t.fuel[mask] + lbRest[i + 1] > cutoff) { cutHit = true; if (sub === 0) break; continue; }
          const nk = nextKey(enc, runs, mask), cand = { f: l.f + t.fuel[mask], v: l.v + t.value[mask], prev: l, mask };
          const cur = next.get(nk);
          if (!cur || cand.f < cur.f || (cand.f === cur.f && cand.v > cur.v)) next.set(nk, cand);
        }
        if (sub === 0) break;
      }
    }
    if (next.size === 0) return cutHit ? { feasible: false, overBudget: true } : { feasible: false, emptyAt: slot, lastLayer: layer, enc };
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
