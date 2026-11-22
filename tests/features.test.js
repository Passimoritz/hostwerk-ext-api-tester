'use strict';
/*
 * Secrets, environments, checks, cookies, forms with files, redirects, cancel, Postman/Insomnia, collection run –
 * against a fake fetch and a simulated Hostwerk (never sends anything to the network).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../server/client');
const I = require('../server/importers');
const { createService } = require('../server/index');

const resp = (status, body, headers = {}, extra = {}) => ({ status, statusText: 'OK', url: extra.url, redirected: !!extra.redirected, headers: new Headers(headers), arrayBuffer: async () => Buffer.from(body) });

test('history keeps no secrets: Authorization, cookies, ?token=, password in the address', () => {
  const r = C.redactRequest({ url: 'https://u:pw@x.example/a?token=abc&page=2', headers: [['Authorization', 'Bearer abc'], ['Accept', 'json'], ['X-Api-Key', '{{key}}']], form: [['password', 'x', 'text'], ['name', 'Alex', 'text']] });
  assert.strictEqual(r.url, 'https://u:••••••@x.example/a?token=••••••&page=2');
  assert.deepStrictEqual(r.headers, [['Authorization', '••••••'], ['Accept', 'json'], ['X-Api-Key', '{{key}}']], 'placeholders stay – they hold no secret');
  assert.deepStrictEqual(r.form.map((x) => x[1]), ['••••••', 'Alex']);
  assert.ok(C.isSecretVar(['token', 'x'])); assert.ok(C.isSecretVar(['base', 'x', true])); assert.ok(!C.isSecretVar(['api_token', 'x', false]));
});

test('environments: values of the chosen environment replace the collection variables', () => {
  const col = { vars: [['base', 'http://localhost'], ['user', 'alex']], envs: [{ id: 'live', vars: [['base', 'https://shop.example']] }], env: 'live' };
  assert.deepStrictEqual(C.varsFor(col), { base: 'https://shop.example', user: 'alex' });
  assert.deepStrictEqual(C.varsFor(col, 'nope'), { base: 'http://localhost', user: 'alex' });
});

test('checks: status, JSON path, header, body, time', () => {
  const r = { status: 201, ms: 120, headers: { 'content-type': 'application/json' }, body: '{"data":{"items":[{"id":7}]}}' };
  const out = C.runChecks([
    { kind: 'status', op: 'eq', value: '201' }, { kind: 'json', path: 'data.items[0].id', op: 'eq', value: '7' }, { kind: 'json', path: 'data.missing', op: 'exists' },
    { kind: 'header', path: 'Content-Type', op: 'contains', value: 'json' }, { kind: 'body', op: 'contains', value: 'items' }, { kind: 'time', op: 'lt', value: '100' },
  ], r);
  assert.deepStrictEqual(out.map((x) => x.ok), [true, true, false, true, true, false]);
  assert.strictEqual(out[5].actual, '120');
  assert.ok(C.runChecks([{ kind: 'status', op: 'eq', value: '200' }], { error: 'x' })[0].ok === false);
});

test('cookies per collection: stored from Set-Cookie, sent again, removed when expired', () => {
  let jar = C.storeCookies({}, 'https://api.example/login', ['sid=abc; Path=/; HttpOnly', 'theme=dark']);
  assert.deepStrictEqual(jar, { 'api.example': { sid: 'abc', theme: 'dark' } });
  assert.strictEqual(C.cookieHeader(jar, 'https://sub.api.example/x'), 'sid=abc; theme=dark');
  assert.strictEqual(C.cookieHeader(jar, 'https://other.example/'), '');
  jar = C.storeCookies(jar, 'https://api.example/logout', ['sid=; Max-Age=0']);
  assert.deepStrictEqual(jar, { 'api.example': { theme: 'dark' } });
});

test('send: redirects only when wanted, own time limit, cancel, cookies, form with a file', async () => {
  const seen = [];
  const fetchFn = async (url, o) => { seen.push({ url, o }); if (o.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); return resp(200, '{}', { 'set-cookie': 'a=1' }, { url }); };
  await C.send({ method: 'GET', url: 'http://x/' }, {}, { fetchFn });
  assert.strictEqual(seen[0].o.redirect, 'manual');
  await C.send({ method: 'GET', url: 'http://x/', options: { follow: true, timeout: 5 } }, {}, { fetchFn, cookies: { x: { sid: '1' } } });
  assert.strictEqual(seen[1].o.redirect, 'follow');
  assert.strictEqual(seen[1].o.headers.Cookie, 'sid=1');
  const ac = new AbortController(); ac.abort();
  const c = await C.send({ method: 'GET', url: 'http://x/' }, {}, { fetchFn, signal: ac.signal });
  assert.ok(c.cancelled && /Cancelled/.test(c.error));
  const r = await C.send({ method: 'POST', url: 'http://x/up', bodyType: 'multipart', headers: [['Content-Type', 'x']], form: [['name', '{{who}}', 'text'], ['file', 'C:/f.txt', 'file']] }, { who: 'Alex' }, { fetchFn, readFile: async (p) => ({ data: Buffer.from('hello'), name: path.basename(p), type: 'text/plain' }) });
  const fd = seen[3].o.body;
  assert.ok(fd instanceof FormData);
  assert.strictEqual(fd.get('name'), 'Alex');
  assert.strictEqual(fd.get('file').name, 'f.txt');
  assert.ok(!Object.keys(seen[3].o.headers).some((k) => k.toLowerCase() === 'content-type'), 'fetch sets the multipart boundary itself');
  assert.deepStrictEqual(r.setCookies, ['a=1']);
});

test('Postman and Insomnia in, Postman out – folders, variables, auth, environments', () => {
  const pm = { info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: [{ key: 'base', value: 'https://shop.example' }], item: [
    { name: 'Users', item: [{ name: 'List', request: { method: 'GET', url: { raw: '{{base}}/users' }, auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] } } }, { name: 'Admin', item: [{ name: 'Create', request: { method: 'POST', url: '{{base}}/users', body: { mode: 'raw', raw: '{"a":1}' } } }] }] },
    { name: 'Login', request: { method: 'POST', url: '{{base}}/login', body: { mode: 'urlencoded', urlencoded: [{ key: 'user', value: 'a b' }, { key: 'x', value: 'y', disabled: true }] } } },
  ] };
  const d = I.detect(JSON.stringify(pm));
  assert.strictEqual(d.kind, 'postman');
  const c = d.collection;
  assert.deepStrictEqual(c.requests.map((r) => `${r.folder}|${r.name}|${r.method}`), ['Users|List|GET', 'Users/Admin|Create|POST', '|Login|POST']);
  assert.deepStrictEqual(c.requests[0].headers, [['Authorization', 'Bearer {{token}}']]);
  assert.strictEqual(c.requests[2].body, 'user=a%20b');
  assert.strictEqual(c.requests[2].bodyType, 'form');
  const back = I.toPostman({ ...C.cleanCollections([c])[0], vars: [['base', 'https://shop.example', false], ['token', 'secret', true]] });
  assert.strictEqual(back.item[0].name, 'Users');
  assert.strictEqual(back.item[0].item[1].item[0].name, 'Create');
  assert.deepStrictEqual(back.variable, [{ key: 'base', value: 'https://shop.example' }, { key: 'token', value: '' }], 'secret values stay empty');

  const ins = { _type: 'export', __export_format: 4, resources: [
    { _id: 'wrk', _type: 'workspace', name: 'Blog' }, { _id: 'fld', _type: 'request_group', parentId: 'wrk', name: 'Posts' },
    { _id: 'r1', _type: 'request', parentId: 'fld', name: 'All posts', method: 'GET', url: '{{ _.base }}/posts', headers: [{ name: 'Accept', value: 'json' }] },
    { _id: 'env', _type: 'environment', parentId: 'wrk', name: 'Base', data: { base: 'http://localhost' } }, { _id: 'env2', _type: 'environment', parentId: 'env', name: 'Live', data: { base: 'https://blog.example' } },
  ] };
  const di = I.detect(JSON.stringify(ins));
  assert.strictEqual(di.kind, 'insomnia');
  assert.strictEqual(di.collection.requests[0].folder, 'Posts');
  assert.strictEqual(di.collection.requests[0].url, '{{base}}/posts');
  assert.deepStrictEqual(di.collection.vars, [['base', 'http://localhost']]);
  assert.strictEqual(di.collection.envs[0].name, 'Live');
});

function service(fetchFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-apit-'));
  const host = { ctx: { paths: { data: dir } }, t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => v[k]) : s), error: (st, m) => Object.assign(new Error(m), { status: st }) };
  const secrets = { seal: (x) => Buffer.from(x).toString('base64'), open: (x) => Buffer.from(x, 'base64').toString() };
  return { svc: createService(host, { secrets, fetchFn }), dir };
}

test('secret variables: sealed on disk, masked for the page, used for sending, history without them', async () => {
  const sent = [];
  const { svc, dir } = service(async (url, o) => { sent.push({ url, o }); return resp(200, '{"ok":true}', { 'set-cookie': 'sid=xyz' }, { url }); });
  const page = svc.saveFromPage([{ id: 'c', name: 'Shop', vars: [['base', 'https://shop.example'], ['token', 'TOPSECRET']], envs: [{ id: 'st', name: 'Staging', vars: [['base', 'https://staging.example']] }], env: 'st', cookieJar: true, requests: [{ id: 'r', name: 'Me', method: 'GET', url: '{{base}}/me?api_key={{token}}', headers: [['Authorization', 'Bearer {{token}}']], checks: [{ kind: 'status', op: 'eq', value: '200' }] }] }]);
  assert.deepStrictEqual(page[0].vars, [['base', 'https://shop.example', false], ['token', '••••••', true]]);
  const disk = fs.readFileSync(path.join(dir, 'api-tester', 'collections.json'), 'utf8');
  assert.ok(!disk.includes('TOPSECRET'), 'never in plain text on disk');
  // The page saves again with the masked value – the secret stays
  svc.saveFromPage(page);
  const r = await svc.sendOne('c', page[0].requests[0]);
  assert.strictEqual(sent[0].url, 'https://staging.example/me?api_key=TOPSECRET', 'environment + secret used for sending');
  assert.strictEqual(sent[0].o.headers.Authorization, 'Bearer TOPSECRET');
  assert.ok(r.checks[0].ok);
  assert.strictEqual(r.request.headers.Authorization, '••••••', 'the page never sees the filled secret');
  const hist = JSON.stringify(svc.read('history', []));
  assert.ok(!hist.includes('TOPSECRET'), 'history without secrets');
  // Cookie from the answer goes with the next request – and its value never to the page
  await svc.sendOne('c', page[0].requests[0], { history: false });
  assert.strictEqual(sent[1].o.headers.Cookie, 'sid=xyz');
  assert.strictEqual(svc.forPage()[0].cookieCount, 1);
  assert.deepStrictEqual(svc.forPage()[0].cookies, {});
});

test('collection run with checks; cancel a running request', async () => {
  let n = 0;
  const { svc } = service(async (url, o) => {
    if (url.includes('slow')) return new Promise((resolve, reject) => o.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    n++; return resp(n === 1 ? 200 : 404, '{}', {}, { url });
  });
  svc.saveFromPage([{ id: 'c', name: 'Shop', vars: [['base', 'http://x']], requests: [
    { id: 'a', name: 'Ok', method: 'GET', url: '{{base}}/a', checks: [{ kind: 'status', op: 'eq', value: '200' }] },
    { id: 'b', name: 'Missing', method: 'GET', url: '{{base}}/b' },
  ] }]);
  const run = await svc.runCollection('c');
  assert.deepStrictEqual([run.passed, run.failed], [1, 1]);
  assert.deepStrictEqual(run.results.map((x) => x.ok), [true, false]);
  const p = svc.sendOne('c', { method: 'GET', url: 'http://x/slow' }, { rid: 'r1', history: false });
  await new Promise((r) => setTimeout(r, 20));
  svc.running.get('r1').abort();
  const res = await p;
  assert.ok(res.cancelled);
  assert.ok(!svc.running.has('r1'));
});

test('secret variables: unlocking gives the plain value back, renaming keeps the value', async () => {
  const { svc } = service(async (url) => resp(200, url, {}, { url }));
  let page = svc.saveFromPage([{ id: 'c', name: 'S', vars: [['token', 'TOPSECRET', true], ['key', 'K1', true]], requests: [] }]);
  assert.deepStrictEqual(page[0].vars.map((v) => v[1]), [C.MASK, C.MASK]);
  // Lock off on "token" (value still masked on the page), "key" renamed to "apikey"
  page = svc.saveFromPage([{ ...page[0], vars: [['token', C.MASK, false], ['apikey', C.MASK, true]] }]);
  assert.deepStrictEqual(page[0].vars[0], ['token', 'TOPSECRET', false], 'no "sealed:…" text after unlocking');
  assert.deepStrictEqual(svc.opened()[0].vars[1], ['apikey', 'K1', true]);
  const r = await svc.sendOne('c', { method: 'GET', url: 'http://x/{{token}}/{{apikey}}' }, { history: false });
  assert.strictEqual(r.body, 'http://x/TOPSECRET/K1');
});

test('collection run: a request without a valid address fails alone, the run goes on', async () => {
  const { svc } = service(async (url) => resp(200, '{}', {}, { url }));
  svc.saveFromPage([{ id: 'c', name: 'S', vars: [], requests: [
    { id: 'a', name: 'Broken', method: 'GET', url: '{{missing}}/x', checks: [{ kind: 'status', op: 'eq', value: '200' }] },
    { id: 'b', name: 'Ok', method: 'GET', url: 'http://x/ok' },
  ] }]);
  const run = await svc.runCollection('c');
  assert.deepStrictEqual(run.results.map((x) => x.ok), [false, true]);
  assert.match(run.results[0].error, /valid address/);
  assert.strictEqual(run.results[0].checks[0].ok, false);
});

test('saving junk from the page drops broken entries instead of failing', () => {
  const out = C.cleanCollections([null, 1, 'x', [], { id: 'c', name: 'Ok', envs: [null, { id: 'e' }], cookies: { h: null }, requests: [null, { id: 'r', headers: [null, ['A', 'b'], 'x'] }] }]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].envs.map((e) => e.id), ['e']);
  assert.deepStrictEqual(out[0].requests[0].headers, [['A', 'b']]);
});

test('a huge or endless answer is not read completely (memory stays small)', async () => {
  let pulled = 0;
  const endless = new ReadableStream({ pull(ctl) { pulled += 1; ctl.enqueue(new Uint8Array(1024 * 1024).fill(97)); } });
  const fetchFn = async (url) => ({ status: 200, statusText: 'OK', url, headers: new Headers({ 'content-type': 'text/plain' }), body: endless });
  const r = await C.send({ method: 'GET', url: 'http://x/stream' }, {}, { fetchFn });
  assert.ok(r.cut);
  assert.strictEqual(r.body.length, 2 * 1024 * 1024);
  assert.ok(r.size >= 64 * 1024 * 1024 && pulled < 80, 'stops counting after 64 MB');
});

test('values of secret variables never reach the history or the page', async () => {
  const { svc } = service(async (url) => resp(200, '{}', {}, { url }));
  svc.saveFromPage([{ id: 'c', name: 'S', vars: [['tok', 'SUPERSECRET42', true]], requests: [] }]);
  const r = await svc.sendOne('c', { method: 'POST', url: 'http://x/?q={{tok}}', headers: [['X-Custom', 'k {{tok}}']], body: '{"p":"{{tok}}"}' });
  assert.ok(!JSON.stringify(r.request).includes('SUPERSECRET42'));
  assert.ok(!JSON.stringify(svc.read('history', [])).includes('SUPERSECRET42'));
});

test('size over 64 MB is marked as "at least"; small answers are not', async () => {
  const endless = new ReadableStream({ pull(ctl) { ctl.enqueue(new Uint8Array(1024 * 1024).fill(97)); } });
  const big = await C.send({ method: 'GET', url: 'http://x/stream' }, {}, { fetchFn: async (url) => ({ status: 200, statusText: 'OK', url, headers: new Headers({ 'content-type': 'text/plain' }), body: endless }) });
  assert.strictEqual(big.sizeAtLeast, true);
  const small = await C.send({ method: 'GET', url: 'http://x/a' }, {}, { fetchFn: async (url) => resp(200, 'hi', {}, { url }) });
  assert.strictEqual(small.sizeAtLeast, undefined);
});

test('secret values are also masked URL-encoded (spaces and special characters in the address)', async () => {
  const scrub = C.scrubber(['a b&c=d/ü', 'xy']);
  for (const s of ['http://h/?k=a%20b%26c%3Dd%2F%C3%BC', 'http://h/?k=a+b%26c%3Dd%2F%C3%BC', 'http://h/a%20b&c=d/%C3%BC', 'raw a b&c=d/ü']) assert.ok(!/a(%20|\+| )b/.test(scrub(s)), `${s} → ${scrub(s)}`);
  assert.strictEqual(scrub('xy stays'), 'xy stays', 'too short values are not masked');
  const sent = [];
  const { svc } = service(async (url) => { sent.push(url); return resp(200, '{}', {}, { url }); });
  const page = svc.saveFromPage([{ id: 'c', name: 'S', vars: [['tok', 'p@ss w0rd/ü', true]], requests: [{ id: 'r', name: 'R', method: 'GET', url: 'http://h/x?token={{tok}}&q={{tok}}' }] }]);
  const r = await svc.sendOne('c', page[0].requests[0]);
  assert.ok(sent[0].includes('w0rd') || decodeURIComponent(sent[0]).includes('w0rd'), 'sent with the real value');
  const hist = JSON.stringify(svc.read('history', []));
  assert.ok(!hist.includes('w0rd'), `history: ${hist}`);
  assert.ok(!String(r.request.url).includes('w0rd'), `page: ${r.request.url}`);
});
