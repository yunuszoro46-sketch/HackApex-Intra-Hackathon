'use strict';
// The screen. It sends the input JSON to POST /api/roster (the same endpoint any market can call) and draws the
// response. It never computes the roster itself; the only arithmetic here is formatting.

const $ = (id) => document.getElementById(id);
let lastInput = null, lastResponse = null, lastRaw = '';
const HOURS = Array.from({ length: 10 }, (_, h) => `${String(10 + h).padStart(2, '0')}:00`);
const fmtL = (x) => Number(x).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function postRoster(text) {
  const res = await fetch('/api/roster', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
  const raw = await res.text();
  let body; try { body = JSON.parse(raw); } catch { body = { status: 'error', message: `unexpected response (HTTP ${res.status})` }; }
  return { httpStatus: res.status, body, raw };
}

async function compute() {
  const text = $('input').value.trim();
  if (!text) { showMessage('error', 'Paste or upload an input JSON first.'); return; }
  $('busy').hidden = false; $('btn-compute').disabled = true;
  try {
    const { httpStatus, body, raw } = await postRoster(text);
    lastResponse = body; lastRaw = raw;
    try { lastInput = JSON.parse(text); } catch { lastInput = null; }
    render(httpStatus, body);
  } catch (e) {
    showMessage('error', `Could not reach the server: ${e.message}`);
  } finally {
    $('busy').hidden = true; $('btn-compute').disabled = false;
  }
}

function showMessage(kind, text) {
  $('result').hidden = false;
  $('summary').innerHTML = `<span class="pill ${kind}">${kind === 'error' ? 'ERROR' : kind.toUpperCase()}</span><span>${esc(text)}</span>`;
  $('problem').innerHTML = ''; $('board-wrap').hidden = true; $('reasons-wrap').hidden = true;
}

function render(httpStatus, body) {
  $('result').hidden = false;
  $('btn-download').disabled = false;
  $('btn-print').disabled = body.status === 'invalid_input' || body.status === 'error';
  if (body.status === 'invalid_input') {
    $('summary').innerHTML = `<span class="pill invalid_input">INVALID INPUT</span><span>HTTP ${httpStatus}</span>`;
    $('problem').innerHTML = `<div class="problem bad"><b>The input does not match the format.</b><br>Field <code>${esc(body.field)}</code>: ${esc(body.message)}</div>`;
    $('board-wrap').hidden = true; $('reasons-wrap').hidden = true;
    return;
  }
  if (body.status === 'error') {
    $('summary').innerHTML = `<span class="pill error">ERROR</span><span>${esc(body.message || '')}</span>`;
    $('problem').innerHTML = body.violations ? `<div class="problem bad"><ul>${body.violations.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div>` : '';
    $('board-wrap').hidden = true; $('reasons-wrap').hidden = true;
    return;
  }
  const shown = body.status === 'ok' ? body : body.best_effort;
  const budget = shown ? shown.fuel_budget_litres : (lastInput && lastInput.fuel_budget_litres);
  const outageCount = lastInput ? lastInput.grid_available.filter((g) => !g).length : (shown ? shown.roster.length : 0);
  $('summary').innerHTML = [
    `<span class="pill ${body.status}">${body.status === 'ok' ? 'OK' : 'INFEASIBLE'}</span>`,
    body.status === 'ok' ? stat(body.value_total, 'total value served') : '',
    body.status === 'ok' ? stat(`${fmtL(body.fuel_total_litres)} / ${fmtL(budget)} L`, 'diesel used / budget') : '',
    stat(outageCount, 'outage hours'),
    body.status === 'ok' ? stat(body.optimal ? 'Proven best' : 'Not proven', body.optimal ? 'no roster scores higher' : 'time limit reached') : '',
  ].join('');

  if (body.status === 'infeasible') {
    $('problem').innerHTML = `<div class="problem"><b>No roster can keep every rule today.</b><ul>${body.conflicts.map((c) =>
      `<li><b>${esc(ruleName(c.rule))}</b>: ${esc(c.detail)}${c.shops.length ? `<br><span class="muted">Shops: ${esc(c.shops.join(', '))}</span>` : ''}</li>`).join('')}</ul></div>`;
  } else $('problem').innerHTML = '';

  if (!shown) { $('board-wrap').hidden = true; $('reasons-wrap').hidden = true; return; }
  $('board-wrap').hidden = false; $('reasons-wrap').hidden = false;
  $('board-title').textContent = body.status === 'ok' ? '2. Roster' : '2. Best-effort roster (for reference only)';
  drawBoard(shown, body.status !== 'ok' ? shown.label : null);
  drawReasons(shown);
}

const stat = (big, small) => `<div class="stat"><b>${esc(big)}</b><span>${esc(small)}</span></div>`;
const ruleName = (r) => ({ capacity: 'Generator capacity', fuel: 'Diesel budget', max_consecutive_dark: 'Dark-hours rule', combined: 'Rules together' }[r] || r);

function drawBoard(res, warning) {
  const shops = lastInput ? lastInput.shops : [];
  const bySlot = new Map(res.roster.map((r) => [r.slot, r]));
  const reasonOf = (slot, id) => { const r = bySlot.get(slot); const d = r && r.dark.find((x) => x.id === id); return d ? d.reason : ''; };
  let html = '';
  html += `<thead><tr><th>Shop</th>${HOURS.map((t) => `<th>${t}</th>`).join('')}<th>Dark h</th></tr></thead><tbody>`;
  for (const s of shops) {
    const star = s.type === 'mandatory' ? ' <span class="star" title="mandatory: on in every outage hour">★</span>' : '';
    html += `<tr><td class="name">${esc(s.id)}${star} <small>${s.kw} kW</small></td>`;
    for (let h = 0; h < 10; h++) {
      const r = bySlot.get(h);
      if (!r) { html += '<td class="grid">grid</td>'; continue; }
      if (r.powered.includes(s.id)) html += '<td class="on" title="powered">✓</td>';
      else html += `<td class="off" tabindex="0" data-slot="${h}" data-id="${esc(s.id)}" title="${esc(reasonOf(h, s.id))}">✗</td>`;
    }
    html += `<td>${res.dark_hours ? res.dark_hours[s.id] : ''}</td></tr>`;
  }
  html += '</tbody><tfoot>';
  const row = (label, f) => `<tr><td class="label">${label}</td>${HOURS.map((_, h) => { const r = bySlot.get(h); return r ? f(r) : '<td class="grid">–</td>'; }).join('')}<td></td></tr>`;
  html += row('Load / capacity (kW)', (r) => `<td class="${r.load_kw > res.capacity_kw ? 'over' : ''}">${r.load_kw} / ${res.capacity_kw}</td>`);
  html += row('Diesel this hour (L)', (r) => `<td>${fmtL(r.fuel_litres)}</td>`);
  html += row(`Running total / ${fmtL(res.fuel_budget_litres)} L`, (r) => `<td class="${r.fuel_running_litres > res.fuel_budget_litres ? 'over' : ''}">${fmtL(r.fuel_running_litres)}</td>`);
  html += '</tfoot>';
  const board = $('board');
  board.innerHTML = html;
  const old = $('board-wrap').querySelector('.banner'); if (old) old.remove();
  if (warning) board.parentElement.insertAdjacentHTML('beforebegin', `<div class="banner">${esc(warning)}</div>`);
  board.querySelectorAll('td.off').forEach((td) => {
    td.addEventListener('click', () => select(td.dataset.slot, td.dataset.id));
    td.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(td.dataset.slot, td.dataset.id); } });
  });
}

function drawReasons(res) {
  const items = [];
  for (const r of res.roster) for (const d of r.dark) items.push(`<li data-key="${r.slot}|${esc(d.id)}"><span class="who">${r.time} ${esc(d.id)}</span>: ${esc(d.reason)}</li>`);
  $('reasons').innerHTML = items.length ? items.join('') : '<li>No shop is dark in any outage hour.</li>';
}

function select(slot, id) {
  document.querySelectorAll('.sel').forEach((e) => e.classList.remove('sel'));
  const cell = document.querySelector(`td.off[data-slot="${slot}"][data-id="${CSS.escape(id)}"]`);
  const li = document.querySelector(`#reasons li[data-key="${slot}|${CSS.escape(id)}"]`);
  if (cell) cell.classList.add('sel');
  if (li) { li.classList.add('sel'); li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

$('btn-compute').addEventListener('click', compute);
$('btn-sample').addEventListener('click', async () => {
  const res = await fetch('/sample_input.json'); $('input').value = await res.text(); compute();
});
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  $('input').value = await f.text(); e.target.value = ''; compute();
});
$('btn-download').addEventListener('click', () => {
  if (!lastRaw) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lastRaw], { type: 'application/json' }));
  a.download = `roster_output_${lastResponse && lastResponse.status}.json`;
  a.click(); URL.revokeObjectURL(a.href);
});
$('btn-print').addEventListener('click', () => window.print());
