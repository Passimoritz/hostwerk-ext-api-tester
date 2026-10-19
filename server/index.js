'use strict';
/*
 * API tester – server part (SDK 2.7 native extension).
 *   GET  /api/api-tester             → { collections, history }
 *   PUT  /api/api-tester/collections → save all collections
 *   POST /api/api-tester/send        → { request, vars } → response (status, time, size, headers, body)
 *   POST /api/api-tester/curl        → { command } → request
 *   POST /api/api-tester/to-curl     → { request, vars } → { command }
 *   GET  /api/api-tester/targets     → addresses of web servers, virtual hosts and apps (to pick a base URL)
 *   DELETE /api/api-tester/history   → clear the history
 * Data: data/api-tester/{collections,history}.json
 */
const fs = require('fs');
const path = require('path');
const C = require('./client');

function activate(host) {
  const { ctx } = host;
  const dir = path.join(ctx.paths.data, 'api-tester');
  fs.mkdirSync(dir, { recursive: true });
  const file = (n) => path.join(dir, `${n}.json`);
  const read = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
  const write = (n, v) => { const tmp = `${file(n)}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, file(n)); };
  if (!fs.existsSync(file('collections'))) {
    // First start: one collection with a working example against Hostwerk's own health endpoint
    write('collections', [{ id: 'start', name: host.t('My first collection'), vars: [['base', 'http://localhost']], requests: [{ id: 'hello', name: host.t('Home page'), method: 'GET', url: '{{base}}/', headers: [], body: '', bodyType: 'json' }] }]);
  }

  host.router.get('/api-tester', (req, res) => res.json({ collections: read('collections', []), history: read('history', []) }));
  host.router.put('/api-tester/collections', (req, res) => { const c = C.cleanCollections((req.body || {}).collections); write('collections', c); res.json(c); });
  host.router.post('/api-tester/send', async (req, res) => {
    const b = req.body || {};
    const vars = Object.fromEntries((Array.isArray(b.vars) ? b.vars : []).filter(([k]) => k));
    const r = await C.send(b.request || {}, vars, { timeoutMs: b.timeoutMs });
    // History: request + short answer (body cut to 4 KB so the file stays small)
    const h = read('history', []);
    h.unshift({ t: Date.now(), name: (b.request || {}).name || '', method: r.request ? r.request.method : (b.request || {}).method, url: r.request ? r.request.url : (b.request || {}).url, status: r.status || null, ms: r.ms, size: r.size || 0, error: r.error || null, request: b.request || {} });
    write('history', h.slice(0, 50));
    res.json(r);
  });
  host.router.post('/api-tester/curl', (req, res) => res.json(C.parseCurl((req.body || {}).command)));
  host.router.post('/api-tester/to-curl', (req, res) => { const b = req.body || {}; res.json({ command: C.toCurl(b.request || {}, Object.fromEntries((Array.isArray(b.vars) ? b.vars : []).filter(([k]) => k))) }); });
  host.router.delete('/api-tester/history', (req, res) => { write('history', []); res.json({ ok: true }); });
  host.router.get('/api-tester/targets', (req, res) => {
    const out = [];
    for (const w of ctx.web ? ctx.web.list() : []) {
      if (!w.httpPort) continue;
      const port = w.httpPort === 80 ? '' : `:${w.httpPort}`;
      out.push({ label: `${w.name}`, url: `http://localhost${port}` });
      for (const v of w.vhosts || []) out.push({ label: `${v.domain} (${w.name})`, url: `http://${v.domain}${port}` });
    }
    for (const a of ctx.apps ? ctx.apps.list() : []) if (a.port) out.push({ label: `${a.name} (App)`, url: `http://localhost:${a.port}` });
    res.json(out);
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
