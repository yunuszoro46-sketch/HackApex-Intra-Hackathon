'use strict';
// Input validation (brief rules 2, 4 and 9). Anything that does not match the format is invalid_input and the
// message names the field. Validation never looks at feasibility: a valid file whose rules cannot all be met is
// "infeasible", which the solver decides, not this file.
// Unknown extra fields (the official sample carries "_story") are accepted.

class InvalidInput extends Error {
  constructor(field, message) { super(message); this.field = field; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isWhole = (v) => isNum(v) && Number.isInteger(v);
const twoDecimals = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

function fail(field, message) { throw new InvalidInput(field, message); }

function need(obj, key, where = '') {
  if (!(key in obj)) fail(where + key, `${where + key} is missing`);
  return obj[key];
}

function litres(v, field) {
  if (!isNum(v)) fail(field, `${field} must be a number`);
  if (v < 0) fail(field, `${field} must not be negative`);
  if (!twoDecimals(v)) fail(field, `${field} has more than two decimals`);
}

function validate(input) {
  if (!isObj(input)) fail('body', 'the request body must be a JSON object');

  const grid = need(input, 'grid_available');
  if (!Array.isArray(grid) || grid.length !== 10) fail('grid_available', 'grid_available must be a list of exactly 10 booleans');
  grid.forEach((g, i) => { if (typeof g !== 'boolean') fail(`grid_available[${i}]`, `grid_available[${i}] must be true or false`); });

  const cap = need(input, 'generator_capacity_kw');
  if (!isWhole(cap) || cap <= 0) fail('generator_capacity_kw', 'generator_capacity_kw must be a positive whole number');

  litres(need(input, 'fuel_budget_litres'), 'fuel_budget_litres');

  const table = need(input, 'fuel_table');
  if (!Array.isArray(table) || table.length === 0) fail('fuel_table', 'fuel_table must be a non-empty list');
  table.forEach((lv, i) => {
    const f = `fuel_table[${i}]`;
    if (!isObj(lv)) fail(f, `${f} must be an object`);
    const kw = need(lv, 'load_kw', f + '.');
    if (!isWhole(kw) || kw <= 0) fail(`${f}.load_kw`, `${f}.load_kw must be a positive whole number`);
    if (i > 0 && kw <= table[i - 1].load_kw) fail(`${f}.load_kw`, 'fuel_table load levels must be strictly increasing');
    litres(need(lv, 'litres_per_hour', f + '.'), `${f}.litres_per_hour`);
  });
  if (table[table.length - 1].load_kw !== cap) {
    fail(`fuel_table[${table.length - 1}].load_kw`, 'the last fuel_table level must equal generator_capacity_kw');
  }

  const k = need(input, 'max_consecutive_dark');
  if (!isWhole(k) || k < 0) fail('max_consecutive_dark', 'max_consecutive_dark must be a whole number >= 0');

  const shops = need(input, 'shops');
  if (!Array.isArray(shops)) fail('shops', 'shops must be a list');
  if (shops.length > 12) fail('shops', 'at most 12 shops are allowed');
  const seen = new Set();
  shops.forEach((s, i) => {
    const f = `shops[${i}]`;
    if (!isObj(s)) fail(f, `${f} must be an object`);
    const id = need(s, 'id', f + '.');
    if (typeof id !== 'string' || id.trim() === '') fail(`${f}.id`, `${f}.id must be a non-blank string`);
    if (seen.has(id)) fail(`${f}.id`, `duplicate shop id "${id}"`);
    seen.add(id);
    const kw = need(s, 'kw', f + '.');
    if (!isWhole(kw) || kw <= 0) fail(`${f}.kw`, `${f}.kw must be a positive whole number`);
    const type = need(s, 'type', f + '.');
    if (type !== 'mandatory' && type !== 'normal') fail(`${f}.type`, `${f}.type must be "mandatory" or "normal"`);
    const vals = need(s, 'value_per_slot', f + '.');
    if (!Array.isArray(vals) || vals.length !== 10) fail(`${f}.value_per_slot`, `${f}.value_per_slot must be a list of exactly 10 numbers`);
    vals.forEach((v, j) => {
      if (!isWhole(v) || v < 0) fail(`${f}.value_per_slot[${j}]`, `${f}.value_per_slot[${j}] must be a whole number >= 0`);
    });
  });
  return input;
}

module.exports = { validate, InvalidInput };
