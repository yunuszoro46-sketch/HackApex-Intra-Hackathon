'use strict';
// HTTP server: serves the screen (public/) and POST /api/roster. Node built-ins only, no internet needed.
//   npm start            -> http://localhost:3000   (PORT=xxxx to change)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { rosterFromText } = require('./solver/index');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const STATIC = { '/': 'public/index.html', '/index.html': 'public/index.html', '/app.js': 'public/app.js', '/form.js': 'public/form.js',
  '/styles.css': 'public/styles.css', '/sample_input.json': 'inputs/sample_input.json' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const MAX_BODY = 1024 * 1024;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/roster') {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method !== 'POST') return send(res, 405, { status: 'error', message: 'use POST with the input JSON as the body' });
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send(res, 400, { status: 'invalid_input', field: 'body', message: 'request body larger than 1 MB' }); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      try {
        const { httpStatus, body } = rosterFromText(Buffer.concat(chunks).toString('utf8'));
        send(res, httpStatus, body);
      } catch (e) {
        send(res, 500, { status: 'error', message: `internal error: ${e.message}` });
      }
    });
    return;
  }
  const file = STATIC[url.pathname];
  if (req.method === 'GET' && file) {
    return fs.readFile(path.join(ROOT, file), (err, data) => (err ? send(res, 404, { status: 'error', message: 'not found' })
      : send(res, 200, data.toString('utf8'), TYPES[path.extname(file)])));
  }
  send(res, 404, { status: 'error', message: 'not found' });
}

function start(port = PORT) {
  const server = http.createServer(handle);
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (require.main === module) {
  start().then((s) => console.log(`Who Stays On? running at http://localhost:${s.address().port}  (POST /api/roster)`));
}
module.exports = { start };
