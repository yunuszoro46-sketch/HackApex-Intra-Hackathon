'use strict';
// The screen. It sends the input JSON to POST /api/roster (the same endpoint any market can call) and draws the
// response. It never computes or changes the roster; the only arithmetic here is formatting and summing numbers
// that the response already contains (peak load, remaining diesel, total dark hours).

const $ = (id) => document.getElementById(id);
const SLOTS = 10;
const HOURS = Array.from({ length: SLOTS }, (_, h) => `${String(10 + h).padStart(2, '0')}:00`);
const fmtL = (x) => Number(x).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Reason categories, read from the first words of the solver's own reason text (src/solver/explain.js).
// A reason that matches none of these is shown as "Unlabelled" with its full text, never re-worded here.
const KINDS = [
  { code: 'D', name: 'Diesel', test: /^Diesel:/ },
  { code: 'C', name: 'Capacity', test: /^Capacity:/ },
  { code: 'B', name: 'Too big', test: /^Too big/ },
  { code: 'N', name: 'Never fits', test: /^Never fits/ },
  { code: 'Z', name: 'No gain', test: /^No gain/ },
  { code: 'L', name: 'Least-diesel plan', test: /^Least-diesel plan/ },
  { code: '?', name: 'Not proven', test: /^(Not proven|Trade-off)/ },
];
const kindOf = (reason) => KINDS.find((k) => k.test.test(reason)) || { code: '?', name: 'Unlabelled' };

const state = { input: null, inputText: '', response: null, raw: '', httpStatus: 0, filter: 'all' };

async function postRoster(text) {
  const res = await fetch('/api/roster', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
  const raw = await res.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { status: 'error', message: `The server sent an unexpected reply (HTTP ${res.status}).` }; }
  return { httpStatus: res.status, body, raw };
}

function setStatus(kind, text) { $('status').innerHTML = `<span class="chip ${kind}">${esc(text)}</span>`; }

async function compute() {
  const text = $('input').value.trim();
  if (!text) { showError('There is no input yet. Load the sample, upload a file, or paste the JSON.', false); return; }
  setStatus('loading', 'Computing…');
  $('btn-compute').disabled = true; $('btn-compute').textContent = 'Computing…';
  if (state.response) $('result').classList.add('stale');
  $('result').setAttribute('aria-busy', 'true');
  try {
    const { httpStatus, body, raw } = await postRoster(text);
    state.response = body; state.raw = raw; state.httpStatus = httpStatus; state.inputText = text; state.filter = 'all';
    try { state.input = JSON.parse(text); } catch { state.input = null; }
    render();
  } catch (e) {
    state.response = null; state.raw = '';
    showError(`The roster could not be fetched: ${e.message}. Check that the server is running (npm start), then try again.`, true);
  } finally {
    $('btn-compute').disabled = false; $('btn-compute').textContent = 'Compute roster';
    $('result').removeAttribute('aria-busy');
    markStale();
  }
}

function showError(text, retry) {
  setStatus('error', 'Error');
  $('result').hidden = false; $('result').classList.remove('stale');
  $('metrics').innerHTML = '';
  $('problem').innerHTML = `<div class="problem bad" role="alert"><h3>No result</h3><p>${esc(text)}</p>${retry ? '<button type="button" class="retry" id="btn-retry">Try again</button>' : ''}</div>`;
  if (retry) $('btn-retry').addEventListener('click', compute);
  for (const id of ['charts', 'board-wrap', 'reasons-wrap']) $(id).hidden = true;
  $('btn-download').disabled = true; $('btn-print').disabled = true;
}

// The shown result is stale once the text box no longer holds the input it was computed from.
function markStale() {
  const stale = !!state.response && $('input').value.trim() !== state.inputText;
  $('stale').hidden = !stale;
  $('result').classList.toggle('stale', stale);
}

function render() {
  const body = state.response;
  $('result').hidden = false;
  $('btn-download').disabled = false;
  $('btn-print').disabled = body.status === 'invalid_input' || body.status === 'error';
  $('problem').innerHTML = '';

  if (body.status === 'invalid_input') {
    setStatus('invalid_input', 'Invalid input');
    $('metrics').innerHTML = '';
    $('problem').innerHTML = `<div class="problem bad" role="alert"><h3>The input does not match the format (HTTP ${state.httpStatus})</h3>`
      + `<p>Field <code>${esc(body.field)}</code>: ${esc(body.message)}</p><p class="muted small">Fix that field and press Compute roster again. No roster was made.</p></div>`;
    for (const id of ['charts', 'board-wrap', 'reasons-wrap']) $(id).hidden = true;
    return;
  }
  if (body.status === 'error' || (body.status !== 'ok' && body.status !== 'infeasible')) {
    setStatus('error', 'Error');
    $('metrics').innerHTML = '';
    $('problem').innerHTML = `<div class="problem bad" role="alert"><h3>The server could not produce a roster (HTTP ${state.httpStatus})</h3><p>${esc(body.message || 'Unknown response.')}</p>`
      + `${body.violations ? `<ul>${body.violations.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}<button type="button" class="retry" id="btn-retry">Try again</button></div>`;
    $('btn-retry').addEventListener('click', compute);
    for (const id of ['charts', 'board-wrap', 'reasons-wrap']) $(id).hidden = true;
    return;
  }

  const ok = body.status === 'ok';
  const shown = ok ? body : body.best_effort;
  setStatus(ok ? 'ok' : 'infeasible', ok ? (body.optimal ? 'OK · proven best' : 'OK · not proven best') : 'Infeasible');
  drawMetrics(body, shown);

  if (!ok) {
    $('problem').innerHTML = `<div class="problem" role="alert"><h3>No roster can keep every rule today${body.proven === false ? ' (search stopped early, not proven)' : ''}</h3><ul>${body.conflicts.map((c) =>
      `<li><b>${esc(ruleName(c.rule))}</b>: ${esc(c.detail)}${c.shops && c.shops.length ? `<br><span class="muted small">Shops: ${esc(c.shops.join(', '))}</span>` : ''}`
      + `${c.slots && c.slots.length ? `<span class="muted small"> · Hours: ${esc(c.slots.map((s) => HOURS[s] || s).join(', '))}</span>` : ''}</li>`).join('')}</ul></div>`;
  }
  if (!shown) { for (const id of ['charts', 'board-wrap', 'reasons-wrap']) $(id).hidden = true; return; }
  for (const id of ['charts', 'board-wrap', 'reasons-wrap']) $(id).hidden = false;
  $('board-title').textContent = ok ? 'Roster' : 'Best-effort roster (NOT a valid schedule, for reference only)';
  $('banner').innerHTML = ok ? '' : `<div class="banner">${esc(shown.label || 'Best effort: this roster breaks at least one rule.')}</div>`;
  drawCharts(shown);
  drawBoard(shown);
  drawFilters(shown);
  drawReasons(shown);
}

const ruleName = (r) => ({ capacity: 'Generator capacity', fuel: 'Diesel budget', max_consecutive_dark: 'Dark-hours rule', search_limit: 'Search time limit', combined: 'Rules together' }[r] || r);
const metric = (k, v, d, cls = '', extra = '') => `<div class="metric ${cls}"><div class="k">${esc(k)}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}${extra}</div>`;

function drawMetrics(body, shown) {
  const inp = state.input || {};
  const outage = Array.isArray(inp.grid_available) ? inp.grid_available.filter((g) => g === false).length : (shown ? shown.roster.length : 0);
  const out = [];
  if (body.status === 'ok') {
    const used = body.fuel_total_litres, budget = body.fuel_budget_litres, left = Math.max(0, budget - used);
    const peak = Math.max(0, ...body.roster.map((r) => r.load_kw));
    const darkTotal = Object.values(body.dark_hours).reduce((a, b) => a + b, 0);
    const maxDark = Math.max(0, ...Object.values(body.dark_hours));
    const most = Object.entries(body.dark_hours).filter(([, n]) => n === maxDark && n > 0).map(([id]) => id);
    out.push(metric('Value served', esc(body.value_total), body.optimal ? 'Proven best: no valid roster scores higher' : 'Not proven best: search hit its time limit'));
    out.push(metric('Diesel used', `${fmtL(used)} <small>/ ${fmtL(budget)} L</small>`, `${fmtL(left)} L left in the budget`, 'diesel',
      `<div class="bar" aria-hidden="true"><span style="width:${budget > 0 ? Math.min(100, used / budget * 100) : 0}%"></span></div>`));
    out.push(metric('Peak load', `${peak} <small>/ ${body.capacity_kw} kW</small>`, 'Highest hour against generator capacity'));
    out.push(metric('Outage hours', `${outage} <small>of ${SLOTS}</small>`, 'Hours the generator has to cover'));
    out.push(metric('Dark shop-hours', esc(darkTotal), most.length ? `Most: ${esc(most.join(', '))} (${maxDark} h)` : 'Every shop powered in every outage hour'));
  } else {
    out.push(metric('Status', 'Infeasible', body.proven === false ? 'Not proven: the search stopped early' : 'Proven: no roster keeps every rule'));
    out.push(metric('Diesel budget', `${fmtL(inp.fuel_budget_litres ?? 0)} <small>L</small>`, shown ? `Best effort would use ${fmtL(shown.fuel_total_litres)} L` : '', 'diesel'));
    out.push(metric('Generator', `${esc(inp.generator_capacity_kw ?? '?')} <small>kW</small>`, `Max dark in a row: ${esc(inp.max_consecutive_dark ?? '?')} h`));
    out.push(metric('Outage hours', `${outage} <small>of ${SLOTS}</small>`, 'Hours the generator has to cover'));
  }
  $('metrics').innerHTML = out.join('');
}

// Two small SVG charts drawn from the roster entries. Grid hours are shaded and carry no generator load or diesel.
function drawCharts(res) {
  const bySlot = new Map(res.roster.map((r) => [r.slot, r]));
  const W = 560, H = 210, L = 34, R = 10, T = 16, B = 26, cw = (W - L - R) / SLOTS;
  const axis = (max, step, fmt) => {
    let s = '';
    for (let v = 0; v <= max + 1e-9; v += step) {
      const y = T + (H - T - B) * (1 - v / max);
      s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 4}" y="${y + 3}" text-anchor="end">${fmt(v)}</text>`;
    }
    return s;
  };
  const xLabels = HOURS.map((t, h) => `<text x="${L + cw * h + cw / 2}" y="${H - 8}" text-anchor="middle">${t.slice(0, 2)}</text>`).join('');
  const bands = HOURS.map((_, h) => (bySlot.has(h) ? '' : `<rect class="gridband" x="${L + cw * h + 1}" y="${T}" width="${cw - 2}" height="${H - T - B}"/><text x="${L + cw * h + cw / 2}" y="${H - B - 6}" text-anchor="middle">grid</text>`)).join('');

  // Load per hour vs capacity
  const cap = res.capacity_kw, maxKw = Math.max(cap, ...res.roster.map((r) => r.load_kw)) || 1;
  const ky = (v) => T + (H - T - B) * (1 - v / maxKw);
  const kstep = maxKw <= 10 ? 2 : maxKw <= 40 ? 5 : Math.ceil(maxKw / 8);
  let bars = '';
  for (const r of res.roster) {
    const x = L + cw * r.slot + cw * 0.18, w = cw * 0.64, over = r.load_kw > cap;
    bars += `<rect class="barfill${over ? ' over' : ''}" x="${x}" y="${ky(r.load_kw)}" width="${w}" height="${ky(0) - ky(r.load_kw)}"><title>${r.time}: ${r.load_kw} of ${cap} kW</title></rect>`
      + `<text class="val${over ? ' over' : ''}" x="${x + w / 2}" y="${ky(r.load_kw) - 4}" text-anchor="middle">${r.load_kw}</text>`;
  }
  $('chart-load').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Generator load per outage hour against the ${cap} kW capacity">`
    + `${axis(maxKw, kstep, (v) => v)}${bands}${bars}<line class="limit" x1="${L}" x2="${W - R}" y1="${ky(cap)}" y2="${ky(cap)}"/>`
    + `<text x="${L + 4}" y="${ky(cap) - 4}">capacity ${cap} kW</text>${xLabels}</svg>`;

  // Running diesel vs budget (step line: diesel is spent hour by hour, flat over grid hours)
  const budget = res.fuel_budget_litres, maxL = Math.max(budget, res.fuel_total_litres) * 1.08 || 1;
  const fy = (v) => T + (H - T - B) * (1 - v / maxL);
  const lstep = maxL <= 10 ? 2 : maxL <= 30 ? 4 : Math.ceil(maxL / 6);
  let run = 0, pts = [`${L},${fy(0)}`], dots = '';
  for (let h = 0; h < SLOTS; h++) {
    const r = bySlot.get(h), x1 = L + cw * (h + 1);
    if (r) run = r.fuel_running_litres;
    pts.push(`${L + cw * h},${fy(run - (r ? r.fuel_litres : 0))}`, `${x1},${fy(run)}`);
    if (r) {
      const over = run > budget + 1e-9;
      dots += `<circle class="dot" cx="${x1}" cy="${fy(run)}" r="3.2"><title>${r.time}: +${fmtL(r.fuel_litres)} L, ${fmtL(run)} L so far</title></circle>`
        + `<text class="val${over ? ' over' : ''}" x="${x1 - 2}" y="${fy(run) - 7}" text-anchor="end">${fmtL(run)}</text>`;
    }
  }
  $('chart-fuel').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diesel used so far, ending at ${fmtL(res.fuel_total_litres)} litres against a ${fmtL(budget)} litre budget">`
    + `${axis(maxL, lstep, (v) => v)}${bands}<line class="limit" x1="${L}" x2="${W - R}" y1="${fy(budget)}" y2="${fy(budget)}"/>`
    + `<text x="${L + 4}" y="${fy(budget) - 4}">budget ${fmtL(budget)} L</text><polyline class="line" points="${pts.join(' ')}"/>${dots}${xLabels}</svg>`;
}

function drawBoard(res) {
  const shops = state.input && Array.isArray(state.input.shops) ? state.input.shops : [];
  const bySlot = new Map(res.roster.map((r) => [r.slot, r]));
  const darkOf = (slot, id) => { const r = bySlot.get(slot); return r && r.dark.find((x) => x.id === id); };
  let html = `<thead><tr><th class="name" scope="col">Shop</th>${HOURS.map((t, h) => `<th scope="col" class="${bySlot.has(h) ? 'out' : ''}">${t}<small>${bySlot.has(h) ? 'outage' : 'grid'}</small></th>`).join('')}<th scope="col">Dark h</th></tr></thead><tbody>`;
  for (const s of shops) {
    const mand = s.type === 'mandatory';
    html += `<tr><th scope="row" class="name">${esc(s.id)}${mand ? ' <span class="star" title="Mandatory: on in every outage hour">★</span><span class="visually-hidden"> (mandatory)</span>' : ''} <small>${esc(s.kw)} kW</small></th>`;
    for (let h = 0; h < SLOTS; h++) {
      const r = bySlot.get(h);
      if (!r) { html += '<td class="grid">grid</td>'; continue; }
      if (r.powered.includes(s.id)) { html += '<td class="on" title="Powered">✓<span class="visually-hidden"> powered</span></td>'; continue; }
      const d = darkOf(h, s.id), k = d ? kindOf(d.reason) : { code: '!', name: 'No reason returned' };
      html += `<td class="off" data-slot="${h}" data-id="${esc(s.id)}"><button type="button" title="${esc(d ? d.reason : 'The response gave no reason for this dark hour')}" aria-label="${esc(`${s.id} dark at ${HOURS[h]}: ${k.name}. Show reason`)}">✗<span class="code">${esc(k.code)}</span></button></td>`;
    }
    html += `<td class="darkh">${res.dark_hours ? esc(res.dark_hours[s.id] ?? '') : ''}</td></tr>`;
  }
  html += '</tbody><tfoot>';
  const row = (label, f) => `<tr><th scope="row" class="name">${label}</th>${HOURS.map((_, h) => { const r = bySlot.get(h); return r ? f(r) : '<td class="grid">–</td>'; }).join('')}<td></td></tr>`;
  html += row('Load / capacity (kW)', (r) => `<td class="${r.load_kw > res.capacity_kw ? 'over' : ''}">${r.load_kw} / ${res.capacity_kw}</td>`);
  html += row('Diesel this hour (L)', (r) => `<td class="fuel">${fmtL(r.fuel_litres)}</td>`);
  html += row(`Running total / ${fmtL(res.fuel_budget_litres)} L`, (r) => `<td class="${r.fuel_running_litres > res.fuel_budget_litres + 1e-9 ? 'over' : ''}">${fmtL(r.fuel_running_litres)}</td>`);
  html += '</tfoot>';
  $('board').innerHTML = html;
  $('board').querySelectorAll('td.off button').forEach((b) => b.addEventListener('click', () => select(b.parentElement.dataset.slot, b.parentElement.dataset.id)));
}

function drawFilters(res) {
  const counts = new Map();
  for (const r of res.roster) for (const d of r.dark) { const k = kindOf(d.reason).name; counts.set(k, (counts.get(k) || 0) + 1); }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const btn = (key, label, n) => `<button type="button" data-f="${esc(key)}" aria-pressed="${state.filter === key}">${esc(label)} (${n})</button>`;
  $('filters').innerHTML = btn('all', 'All', total) + [...counts].map(([k, n]) => btn(k, k, n)).join('');
  $('filters').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.f; drawFilters(res); drawReasons(res); }));
}

function drawReasons(res) {
  const items = [];
  for (const r of res.roster) for (const d of r.dark) {
    const k = kindOf(d.reason);
    if (state.filter !== 'all' && state.filter !== k.name) continue;
    items.push(`<li data-key="${r.slot}|${esc(d.id)}"><span class="tag ${k.code === '?' ? '' : k.code}">${esc(k.name)}</span><span class="who">${esc(r.time)} ${esc(d.id)}</span>: ${esc(d.reason || 'No reason returned by the server.')}</li>`);
  }
  $('reasons').innerHTML = items.length ? items.join('') : '<li>No shop is dark in any outage hour.</li>';
}

function select(slot, id) {
  if (state.filter !== 'all') { state.filter = 'all'; const res = state.response.status === 'ok' ? state.response : state.response.best_effort; drawFilters(res); drawReasons(res); }
  document.querySelectorAll('.sel').forEach((e) => e.classList.remove('sel'));
  const cell = document.querySelector(`td.off[data-slot="${slot}"][data-id="${CSS.escape(id)}"]`);
  const li = document.querySelector(`#reasons li[data-key="${slot}|${CSS.escape(id)}"]`);
  if (cell) cell.classList.add('sel');
  if (li) { li.classList.add('sel'); li.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
}

$('btn-compute').addEventListener('click', compute);
$('input').addEventListener('input', markStale);
$('btn-sample').addEventListener('click', async () => {
  try {
    const res = await fetch('/sample_input.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    $('input').value = await res.text(); compute();
  } catch (e) { showError(`The sample could not be loaded: ${e.message}.`, false); }
});
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  $('input').value = await f.text(); e.target.value = ''; compute();
});
$('btn-download').addEventListener('click', () => {
  if (!state.raw) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([state.raw], { type: 'application/json' }));
  a.download = `roster_output_${state.response && state.response.status}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0);
});
$('btn-print').addEventListener('click', () => window.print());
