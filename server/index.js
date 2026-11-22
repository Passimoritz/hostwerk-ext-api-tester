'use strict';
/*
 * API tester – server part (SDK 2.7 native extension).
 *   GET    /api/api-tester             → { collections (secret values masked), history }
 *   PUT    /api/api-tester/collections → save all collections (masked values keep what was stored)
 *   POST   /api/api-tester/send        → { col, request, env?, rid? } → response (status, time, size, headers, body, checks)
 *   POST   /api/api-tester/cancel      → { rid } – stop a running request
 *   POST   /api/api-tester/run         → { col, env? } → run every request of a collection with its checks
 *   POST   /api/api-tester/schedule    → { col, time } → Hostwerk task that runs the collection every day
 *   GET    /api/api-tester/run/:col/:token  (public) run with the secret link – 200 = all checks passed, 500 = not
 *   POST   /api/api-tester/curl        → { command } → request
 *   POST   /api/api-tester/to-curl     → { col, request, env? } → { command }
 *   GET    /api/api-tester/targets     → addresses of web servers, virtual hosts and apps (to pick a base URL)
 *   DELETE /api/api-tester/history     → clear the history
 *   POST   /api/api-tester/openapi     → { text | url } (OpenAPI 3 / Swagger 2, JSON or YAML) → new collection
 *   POST   /api/api-tester/import      → { text } (Postman, Insomnia or OpenAPI) → new collection
 *   GET    /api/api-tester/export/:col → Postman collection v2.1
 *   POST   /api/api-tester/page-check  → { col, request, env? } → check the page with the extension "Page check"
 *   POST   /api/api-tester/profile     → { col, request, env? } → { job } measure the request with the extension "Profiler"
 * Secrets: variables named like token/secret/password (or marked) are kept sealed and only shown masked; the history keeps
 * no Authorization/Cookie values. Data: data/api-tester/{collections,history}.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./client');
const O = require('./openapi');
const I = require('./importers');

const MIME = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip', '.xml': 'application/xml' };
const MAX_UPLOAD = 50 * 1024 * 1024;

function createService(host, deps = {}) {
  const { ctx } = host;
  // Sandboxed (installed from a folder/file instead of the catalog) there is no host.core – say why instead of
  // "host.core is not a function" (it also needs the local network, which the sandbox blocks)
  const secrets = deps.secrets || (typeof host.core === 'function' ? host.core('secrets') : null);
  if (!secrets) throw new Error('The API tester needs the full Hostwerk extension host (install it from the catalog) – it cannot run sandboxed.');
  const fetchFn = deps.fetchFn || fetch;
  const dir = path.join(ctx.paths.data, 'api-tester');
  fs.mkdirSync(dir, { recursive: true });
  const file = (n) => path.join(dir, `${n}.json`);
  const read = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
  const write = (n, v) => { const tmp = `${file(n)}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, file(n)); };
  if (!fs.existsSync(file('collections'))) {
    // First start: one collection with a working example against the local web server
    write('collections', [{ id: 'start', name: host.t('My first collection'), vars: [['base', 'http://localhost', false]], envs: [{ id: 'local', name: host.t('Local'), vars: [['base', 'http://localhost', false]] }, { id: 'live', name: host.t('Live'), vars: [['base', 'https://example.org', false]] }], env: 'local', requests: [{ id: 'hello', name: host.t('Home page'), method: 'GET', url: '{{base}}/', headers: [], body: '', bodyType: 'json', checks: [{ kind: 'status', op: 'lt', value: '400' }] }] }]);
  }

  /* ---- Secret variables: sealed on disk ("sealed:…"), masked for the page, open only for sending ---- */
  const SEALED = /^sealed:/;
  const sealRows = (rows) => rows.map(([k, v, secret]) => [k, secret && v && !SEALED.test(v) ? `sealed:${secrets.seal(v)}` : v, secret]);
  const openRows = (rows) => rows.map(([k, v, secret]) => [k, secret && SEALED.test(v || '') ? (() => { try { return secrets.open(v.slice(7)); } catch { return ''; } })() : v, secret]);
  const maskRows = (rows) => rows.map(([k, v, secret]) => [k, secret && v ? C.MASK : v, secret]);
  const stored = () => C.cleanCollections(read('collections', []));
  /** Stored collections with secrets opened (only inside this process). */
  const opened = () => stored().map((c) => ({ ...c, vars: openRows(c.vars), envs: c.envs.map((e) => ({ ...e, vars: openRows(e.vars) })) }));
  const forPage = () => stored().map((c) => ({ ...c, vars: maskRows(c.vars), envs: c.envs.map((e) => ({ ...e, vars: maskRows(e.vars) })), runToken: undefined, hasRunLink: !!c.runToken, cookies: {}, cookieCount: Object.values(c.cookies || {}).reduce((n, l) => n + Object.keys(l).length, 0) }));
  /**
   * Save from the page: masked values (••••••) keep the stored value of the same variable. Compared with the opened
   * values, so a secret that loses its lock becomes plain text again (not "sealed:…"), and a renamed secret keeps its value
   * (same row, old name no longer there).
   */
  const saveFromPage = (list) => {
    const old = opened();
    const keep = (oldRows, rows) => rows.map(([k, v, secret], i) => {
      const prev = oldRows || [];
      const o = prev.find(([ok]) => ok === k) || (prev[i] && !rows.some(([nk]) => nk === prev[i][0]) ? prev[i] : null);
      return [k, v === C.MASK && o ? o[1] : v, secret];
    });
    const next = C.cleanCollections(list).map((c) => {
      const o = old.find((x) => x.id === c.id) || {};
      // Cookie values never travel to the page – they stay as stored (or go when the cookie store is switched off)
      return { ...c, runToken: o.runToken || null, cookies: c.cookieJar ? o.cookies || {} : {}, vars: sealRows(keep(o.vars, c.vars)), envs: c.envs.map((e) => ({ ...e, vars: sealRows(keep(((o.envs || []).find((x) => x.id === e.id) || {}).vars, e.vars)) })) };
    });
    write('collections', next);
    return forPage();
  };
  const patchStored = (id, fn) => { const all = stored(); const c = all.find((x) => x.id === id); if (!c) return null; fn(c); write('collections', all); return c; };

  /** Files for multipart forms: only files the user picked (absolute path), at most 50 MB. */
  const readFile = async (p) => {
    const f = String(p || '');
    if (!path.isAbsolute(f)) throw host.error(400, 'Pick the file with “Choose file”.');
    const st = await fs.promises.stat(f).catch(() => null);
    if (!st || !st.isFile()) throw host.error(400, 'File not found: {file}', { file: path.basename(f) });
    if (st.size > MAX_UPLOAD) throw host.error(400, 'The file is larger than 50 MB.');
    return { data: await fs.promises.readFile(f), name: path.basename(f), type: MIME[path.extname(f).toLowerCase()] };
  };

  const running = new Map(); // rid → AbortController
  /** Send one request of a collection (variables of the active or chosen environment, cookies if switched on). */
  const sendOne = async (colId, request, { env, rid, history = true } = {}) => {
    const col = opened().find((c) => c.id === colId) || { vars: [], envs: [], cookies: {} };
    const vars = C.varsFor(col, env);
    const ac = new AbortController();
    if (rid) running.set(rid, ac);
    let r;
    try { r = await C.send(request || {}, vars, { fetchFn, signal: ac.signal, readFile, cookies: col.cookieJar ? col.cookies : null }); } finally { if (rid) running.delete(rid); }
    r.checks = C.runChecks((request || {}).checks, r);
    if (col.cookieJar && r.setCookies && r.setCookies.length) patchStored(colId, (c) => { c.cookies = C.storeCookies(c.cookies, r.url || (r.request && r.request.url), r.setCookies); });
    // Values of secret variables never leave this process: {{token}} anywhere in the address or body becomes •••••• for the
    // history and the page (before, ?q={{token}} landed in plain text in the history)
    // (auch URL-kodiert – ein Wert mit Leer- oder Sonderzeichen steht nach dem Einsetzen anders in der Adresse)
    const scrub = C.scrubber([...col.vars, ...col.envs.flatMap((e) => e.vars)].filter(([, v, s]) => s && v).map(([, v]) => String(v)));
    if (history) {
      // History: request without secrets + short answer
      const h = read('history', []);
      h.unshift({ t: Date.now(), col: colId, name: (request || {}).name || '', method: r.request ? r.request.method : (request || {}).method, url: scrub(C.redactUrl(r.request ? r.request.url : (request || {}).url)), status: r.status || null, ms: r.ms, size: r.size || 0, ...(r.sizeAtLeast ? { sizeAtLeast: true } : {}), error: r.error || null, request: C.redactRequest(request || {}) });
      write('history', h.slice(0, 50));
    }
    // What was sent (for the page): headers without secret values
    if (r.request) r.request = { ...r.request, url: scrub(r.request.url), body: scrub(r.request.body), headers: Object.fromEntries(Object.entries(C.redactHeaders(r.request.headers)).map(([k, v]) => [k, scrub(v)])), form: undefined };
    delete r.setCookies;
    return r;
  };

  /** Run every request of a collection one after the other with its checks. */
  const runCollection = async (colId, { env } = {}) => {
    const col = stored().find((c) => c.id === colId);
    if (!col) throw host.error(404, 'Collection not found');
    const results = [];
    for (const req of col.requests) {
      // An unusable request (e.g. no valid address) fails on its own – the run goes on with the others
      const r = await sendOne(colId, req, { env, history: false }).catch((e) => ({ error: e.message, ms: 0, checks: C.runChecks(req.checks, { error: e.message }) }));
      const checks = r.checks || [];
      const ok = !r.error && (checks.length ? checks.every((x) => x.ok) : r.status < 400);
      results.push({ id: req.id, name: req.name, folder: req.folder, method: req.method, status: r.status || null, ms: r.ms, error: r.error || null, ok, checks });
    }
    const failed = results.filter((x) => !x.ok).length;
    return { col: colId, name: col.name, at: Date.now(), passed: results.length - failed, failed, results };
  };

  return { forPage, saveFromPage, stored, opened, patchStored, sendOne, runCollection, running, read, write };
}

function activate(host) {
  const { ctx } = host;
  const svc = createService(host);

  // Dienst für andere Erweiterungen (Synergie, z. B. Webhook-Postfach → „Im API-Tester öffnen“): eine Anfrage in eine
  // Sammlung legen (wird angelegt, falls es sie noch nicht gibt) → { col, req } zum direkten Öffnen (#/ext/api-tester?col=…&req=…)
  host.provide('apiTester', {
    addRequest(request, { collection = 'Webhook inbox' } = {}) {
      const all = svc.stored();
      const name = host.t(collection);
      let col = all.find((c) => c.name === name);
      if (!col) { col = { id: Math.random().toString(36).slice(2, 10), name, vars: [], envs: [], requests: [] }; all.push(col); }
      const r = C.cleanCollections([{ id: 'x', name: 'x', vars: [], requests: [request] }])[0].requests[0];
      col.requests.unshift(r);
      svc.write('collections', C.cleanCollections(all));
      return { col: col.id, req: r.id };
    },
    /** Run a collection (e.g. from another extension or a task) → { passed, failed, results } */
    run: (colId, opts) => svc.runCollection(colId, opts),
  });

  const r = host.router;
  const varsOf = (b) => C.varsFor(svc.opened().find((c) => c.id === b.col) || {}, b.env);
  r.get('/api-tester', (req, res) => res.json({ collections: svc.forPage(), history: svc.read('history', []) }));
  r.put('/api-tester/collections', (req, res) => res.json(svc.saveFromPage((req.body || {}).collections)));
  r.post('/api-tester/send', async (req, res) => { const b = req.body || {}; res.json(await svc.sendOne(b.col, b.request, { env: b.env, rid: String(b.rid || '').slice(0, 40) || null })); });
  r.post('/api-tester/cancel', (req, res) => { const a = svc.running.get(String((req.body || {}).rid || '')); if (a) a.abort(); res.json({ ok: !!a }); });
  r.post('/api-tester/run', async (req, res) => { const b = req.body || {}; res.json(await svc.runCollection(b.col, { env: b.env })); });
  // Plan the collection as a Hostwerk task: the task calls the secret run link every day (fails when a check fails)
  r.post('/api-tester/schedule', (req, res) => {
    const b = req.body || {};
    if (!ctx.scheduler) throw host.error(409, 'Tasks are not available.');
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time || '') ? b.time : '06:00';
    const col = svc.patchStored(b.col, (c) => { if (!c.runToken) c.runToken = crypto.randomBytes(16).toString('hex'); });
    if (!col) throw host.error(404, 'Collection not found');
    const port = ctx.port || 7777;
    const target = `http://127.0.0.1:${port}/api/api-tester/run/${col.id}/${col.runToken}`;
    // Planned before? Then only the time changes – no second task for the same collection
    const old = (typeof ctx.scheduler.list === 'function' ? ctx.scheduler.list() || [] : []).find((x) => x && x.action && typeof x.action.target === 'string' && x.action.target.endsWith(`/api/api-tester/run/${col.id}/${col.runToken}`));
    const task = ctx.scheduler.save({ ...(old || {}), name: old ? old.name : host.t('API tests: {name}', { name: col.name }).slice(0, 80), action: { type: 'url', target }, schedule: { mode: 'daily', time, days: [] }, notify: old ? old.notify : 'error' }, old ? old.id : undefined);
    res.json({ task: task.id, name: task.name, updated: !!old });
  });
  host.publicRouter.get('/api-tester/run/:col/:token', async (req, res) => {
    const col = svc.stored().find((c) => c.id === req.params.col);
    const want = Buffer.from((col && col.runToken) || '');
    const got = Buffer.from(String(req.params.token || ''));
    if (!col || !want.length || want.length !== got.length || !crypto.timingSafeEqual(want, got)) return res.status(404).json({ error: 'Not found' });
    const out = await svc.runCollection(col.id);
    res.status(out.failed ? 500 : 200).json({ passed: out.passed, failed: out.failed, results: out.results.map((x) => ({ name: x.name, ok: x.ok, status: x.status, error: x.error, checks: x.checks.filter((c) => !c.ok).map((c) => ({ kind: c.kind, path: c.path, op: c.op, value: c.value, actual: c.actual })) })) });
  });
  r.post('/api-tester/curl', (req, res) => res.json(C.parseCurl((req.body || {}).command)));
  r.post('/api-tester/to-curl', (req, res) => { const b = req.body || {}; res.json({ command: C.toCurl(b.request || {}, varsOf(b)) }); });
  r.delete('/api-tester/cookies/:col', (req, res) => { svc.patchStored(req.params.col, (c) => { c.cookies = {}; }); res.json({ collections: svc.forPage() }); });
  r.delete('/api-tester/history', (req, res) => { svc.write('history', []); res.json({ ok: true }); });
  const yamlParse = () => { try { return host.lib('yaml').parse; } catch { return null; } };
  const fetchText = async (url) => {
    if (!/^https?:\/\//i.test(url)) throw host.error(400, 'Only http:// and https:// addresses are supported.');
    const resp = await fetch(url, { headers: { Accept: 'application/json, application/yaml, text/yaml, */*' }, signal: AbortSignal.timeout(20000) }).catch((e) => { throw host.error(502, 'The address could not be reached: {msg}', { msg: e.message }); });
    if (!resp.ok) throw host.error(502, 'The address answered with {status}.', { status: resp.status });
    // At most a little over 5 MB (more is refused anyway) – a huge answer is not read completely
    const { buf, size } = await C.readCapped(resp, 5 * 1024 * 1024 + 1);
    if (size > 5 * 1024 * 1024) throw host.error(413, 'The description is larger than 5 MB.');
    return buf.toString('utf8');
  };
  // OpenAPI/Swagger (JSON oder YAML, als Text oder Adresse) → neue Sammlung mit allen Anfragen
  r.post('/api-tester/openapi', async (req, res) => {
    const b = req.body || {};
    const url = String(b.url || '').trim();
    const text = url ? await fetchText(url) : String(b.text || '');
    // Nur umwandeln – die Oberfläche fügt die Sammlung über ihren normalen Speicherweg hinzu
    res.json(C.cleanCollections([O.fromOpenApi(O.parseDoc(text, yamlParse()), { source: url })])[0]);
  });
  // Postman, Insomnia oder OpenAPI – erkennt die Art selbst
  r.post('/api-tester/import', async (req, res) => {
    const b = req.body || {};
    const url = String(b.url || '').trim();
    const text = url ? await fetchText(url) : String(b.text || '');
    const d = I.detect(text, yamlParse());
    res.json({ kind: d.kind, collection: C.cleanCollections([d.collection])[0] });
  });
  r.get('/api-tester/export/:col', (req, res) => {
    const col = svc.stored().find((c) => c.id === req.params.col);
    if (!col) throw host.error(404, 'Collection not found');
    res.json(I.toPostman(col));
  });
  // Andocken: diese Anfrage im Profiler messen (Erweiterung „Profiler“) oder die Seite prüfen (Erweiterung „Seiten-Check“)
  r.post('/api-tester/profile', (req, res) => {
    if (!ctx.profiler) throw host.error(409, 'Install the extension “Profiler” to measure requests.');
    const b = req.body || {};
    const x = C.build(b.request || {}, varsOf(b));
    res.json({ job: ctx.profiler.runRequest({ url: x.url, method: x.method, headers: x.headers, body: x.body || null }).id });
  });
  r.post('/api-tester/page-check', async (req, res) => {
    if (!ctx.pageCheck) throw host.error(409, 'Install the extension “Page check” to check pages.');
    const b = req.body || {};
    const x = C.build({ ...(b.request || {}), method: 'GET' }, varsOf(b));
    res.json(await ctx.pageCheck.check(x.url));
  });
  r.get('/api-tester/targets', (req, res) => {
    const out = [];
    for (const w of ctx.web ? ctx.web.list() : []) {
      if (!w.httpPort) continue;
      const port = w.httpPort === 80 ? '' : `:${w.httpPort}`;
      out.push({ label: `${w.name}`, url: `http://localhost${port}` });
      for (const v of w.vhosts || []) out.push({ label: `${v.domain} (${w.name})`, url: `http://${v.domain}${port}` });
    }
    for (const a of ctx.apps ? ctx.apps.list() : []) if (a.port) out.push({ label: `${a.name} (App)`, url: `http://localhost:${a.port}` });
    res.json({ list: out, profiler: !!ctx.profiler, pageCheck: !!ctx.pageCheck });
  });
}

function deactivate() {}

module.exports = { activate, deactivate, createService };
