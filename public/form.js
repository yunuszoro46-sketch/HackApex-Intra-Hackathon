'use strict';
// Form <-> request conversion for the screen. Pure functions, no DOM: the same file runs in the browser
// (window.WSOForm) and in the tests (require). The request it builds is exactly the existing POST /api/roster
// input; the backend (src/solver/validate.js) stays the authority on every rule.
//
// What this file checks itself: only what cannot be turned into a JSON request at all, i.e. an empty field, text
// that is not a number, a missing on/off choice, a blank shop id. Everything else (negative numbers, decimals where
// whole numbers are required, duplicate ids, a bad fuel table, more than 12 shops) is sent as typed, and the server's
// invalid_input answer names the field, which the screen then highlights. Nothing is repaired or guessed here.
(function (root) {
  const SLOTS = 10;
  const HOURS = Array.from({ length: SLOTS }, (_, h) => `${String(10 + h).padStart(2, '0')}:00`);
  const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

  // Strict number parsing: surrounding spaces are ignored, anything else that is not a plain number is an error.
  function parseNumber(text) {
    const t = String(text == null ? '' : text).trim();
    if (t === '') return { error: 'is required' };
    if (!NUMBER.test(t)) return { error: `"${t}" is not a number` };
    return { value: Number(t) };
  }

  // The form's own state: every number kept as the text the user typed.
  function emptyForm() {
    return { capacity: '', budget: '', maxDark: '', grid: Array(SLOTS).fill(true), fuel: [{ kw: '', litres: '' }], shops: [], extra: {} };
  }
  function emptyShop() { return { id: '', kw: '', type: 'normal', values: Array(SLOTS).fill('') }; }

  // Request (parsed JSON) -> form state. Used for "Load the sample" and "Import JSON". A file whose structure the
  // form cannot show (wrong list lengths, text where a number belongs, unknown shop type) is refused with the field
  // named, instead of being converted.
  function requestToForm(input) {
    const bad = (field, message) => ({ error: { field, message } });
    if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('body', 'the file must contain one JSON object');
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    const known = ['grid_available', 'generator_capacity_kw', 'fuel_budget_litres', 'fuel_table', 'max_consecutive_dark', 'shops'];
    for (const k of known) if (!(k in input)) return bad(k, `${k} is missing`);
    if (!Array.isArray(input.grid_available) || input.grid_available.length !== SLOTS || !input.grid_available.every((g) => typeof g === 'boolean')) {
      return bad('grid_available', 'grid_available must be a list of exactly 10 true/false values');
    }
    for (const k of ['generator_capacity_kw', 'fuel_budget_litres', 'max_consecutive_dark']) if (!num(input[k])) return bad(k, `${k} must be a number`);
    if (!Array.isArray(input.fuel_table)) return bad('fuel_table', 'fuel_table must be a list');
    const fuel = [];
    for (const [i, row] of input.fuel_table.entries()) {
      if (!row || typeof row !== 'object' || !num(row.load_kw) || !num(row.litres_per_hour)) return bad(`fuel_table[${i}]`, `fuel_table[${i}] needs numeric load_kw and litres_per_hour`);
      fuel.push({ kw: String(row.load_kw), litres: String(row.litres_per_hour) });
    }
    if (!Array.isArray(input.shops)) return bad('shops', 'shops must be a list');
    const shops = [];
    for (const [i, s] of input.shops.entries()) {
      const f = `shops[${i}]`;
      if (!s || typeof s !== 'object') return bad(f, `${f} must be an object`);
      if (typeof s.id !== 'string') return bad(`${f}.id`, `${f}.id must be text`);
      if (!num(s.kw)) return bad(`${f}.kw`, `${f}.kw must be a number`);
      if (s.type !== 'mandatory' && s.type !== 'normal') return bad(`${f}.type`, `${f}.type must be "mandatory" or "normal"`);
      if (!Array.isArray(s.value_per_slot) || s.value_per_slot.length !== SLOTS || !s.value_per_slot.every(num)) return bad(`${f}.value_per_slot`, `${f}.value_per_slot must be 10 numbers`);
      shops.push({ id: s.id, kw: String(s.kw), type: s.type, values: s.value_per_slot.map(String) });
    }
    const extra = {};
    for (const k of Object.keys(input)) if (!known.includes(k)) extra[k] = input[k];   // e.g. the sample's "_story"
    return {
      form: {
        capacity: String(input.generator_capacity_kw), budget: String(input.fuel_budget_litres), maxDark: String(input.max_consecutive_dark),
        grid: input.grid_available.slice(), fuel, shops, extra,
      },
    };
  }

  // Form state -> request. Returns { request } or { errors: [{ field, message }] } where field uses the same names
  // as the backend's invalid_input answers (e.g. "shops[2].value_per_slot[4]"), so one highlight routine serves both.
  function formToRequest(form) {
    const errors = [];
    const read = (text, field, label) => { const r = parseNumber(text); if (r.error) { errors.push({ field, message: `${label} ${r.error}` }); return null; } return r.value; };
    const grid = [];
    for (let h = 0; h < SLOTS; h++) {
      const g = form.grid[h];
      if (typeof g !== 'boolean') errors.push({ field: `grid_available[${h}]`, message: `${HOURS[h]}: choose grid or outage` });
      grid.push(g);
    }
    const capacity = read(form.capacity, 'generator_capacity_kw', 'Generator capacity');
    const budget = read(form.budget, 'fuel_budget_litres', 'Diesel budget');
    const fuel_table = form.fuel.map((row, i) => ({
      load_kw: read(row.kw, `fuel_table[${i}].load_kw`, `Fuel table row ${i + 1}: load`),
      litres_per_hour: read(row.litres, `fuel_table[${i}].litres_per_hour`, `Fuel table row ${i + 1}: litres per hour`),
    }));
    if (form.fuel.length === 0) errors.push({ field: 'fuel_table', message: 'The fuel table needs at least one row' });
    const maxDark = read(form.maxDark, 'max_consecutive_dark', 'Maximum dark hours in a row');
    const shops = form.shops.map((s, i) => {
      const name = s.id && String(s.id).trim() ? `Shop "${s.id}"` : `Shop ${i + 1}`;
      if (typeof s.id !== 'string' || s.id.trim() === '') errors.push({ field: `shops[${i}].id`, message: `Shop ${i + 1}: ID is required` });
      if (s.type !== 'mandatory' && s.type !== 'normal') errors.push({ field: `shops[${i}].type`, message: `${name}: choose mandatory or normal` });
      return {
        id: s.id,                                   // sent exactly as typed (never trimmed or renamed)
        kw: read(s.kw, `shops[${i}].kw`, `${name}: kW`),
        type: s.type,
        value_per_slot: s.values.map((v, h) => read(v, `shops[${i}].value_per_slot[${h}]`, `${name}: value at ${HOURS[h]}`)),
      };
    });
    if (errors.length) return { errors };
    return {
      request: {
        ...form.extra,
        grid_available: grid, generator_capacity_kw: capacity, fuel_budget_litres: budget, fuel_table,
        max_consecutive_dark: maxDark, shops,
      },
    };
  }

  const api = { SLOTS, HOURS, parseNumber, emptyForm, emptyShop, requestToForm, formToRequest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WSOForm = api;
})(typeof window !== 'undefined' ? window : globalThis);
