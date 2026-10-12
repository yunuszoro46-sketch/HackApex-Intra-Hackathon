'use strict';
// The whole pipeline behind POST /api/roster (and the CLI):
//   validate -> build model -> exact solve -> (if no roster: diagnose) -> serialize with reasons -> independent check
// Returns { httpStatus, body }. 200 for ok and infeasible, 400 for invalid_input (brief), 500 only if our own
// checker catches a broken roster, so a wrong roster is never served.

const { validate, InvalidInput } = require('./validate');
const { buildModel } = require('./model');
const { solveMaxValue } = require('./solve');
const { diagnose } = require('./diagnose');
const { okBody, infeasibleBody } = require('./serialize');
const { checkRoster } = require('./check');

function roster(input, opts = {}) {
  try {
    validate(input);
  } catch (e) {
    if (e instanceof InvalidInput) return { httpStatus: 400, body: { status: 'invalid_input', field: e.field, message: e.message } };
    throw e;
  }
  const model = buildModel(input);
  const result = solveMaxValue(model, opts);
  if (result.feasible) {
    const body = okBody(model, result);
    const violations = checkRoster(input, body);
    if (violations.length) return { httpStatus: 500, body: { status: 'error', message: 'internal check failed; roster withheld', violations } };
    return { httpStatus: 200, body };
  }
  const { conflicts, bestEffort } = diagnose(model);
  return { httpStatus: 200, body: infeasibleBody(model, conflicts, bestEffort) };
}

// For raw request text: a body that is not JSON at all is also invalid_input.
function rosterFromText(text, opts) {
  let input;
  try { input = JSON.parse(text); } catch (e) {
    return { httpStatus: 400, body: { status: 'invalid_input', field: 'body', message: `the request body is not valid JSON (${e.message})` } };
  }
  return roster(input, opts);
}

module.exports = { roster, rosterFromText };
