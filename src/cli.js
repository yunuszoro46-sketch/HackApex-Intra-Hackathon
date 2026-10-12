'use strict';
// Command line: same pipeline as the API, no server needed.
//   node src/cli.js input.json > output.json
// Exit code 0 for ok / infeasible, 1 for invalid_input (brief rule 8: "exits non-zero"), 2 for an internal error.
const fs = require('node:fs');
const { rosterFromText } = require('./solver/index');

const file = process.argv[2];
if (!file) { console.error('usage: node src/cli.js input.json'); process.exit(2); }
const { httpStatus, body } = rosterFromText(fs.readFileSync(file, 'utf8'));
process.stdout.write(JSON.stringify(body, null, 2) + '\n');
process.exit(httpStatus === 200 ? 0 : httpStatus === 400 ? 1 : 2);
