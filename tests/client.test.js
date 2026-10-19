'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const C = require('../server/client');
const de = require('../locales/de.json');

test('variables are filled, unknown ones stay visible', () => {
  assert.strictEqual(C.fill('{{base}}/x/{{ id }}?q={{nope}}', { base: 'http://a', id: 7 }), 'http://a/x/7?q={{nope}}');
});

test('build: method, headers, JSON body gets its content type, GET has no body', () => {
  const r = C.build({ method: 'post', url: '{{base}}/u', headers: [['X-Token', '{{t}}'], ['#off', 'x'], ['', '']], body: '{"a":1}', bodyType: 'json' }, { base: 'http://localhost:9', t: 'abc' });
  assert.strictEqual(r.method, 'POST'); assert.strictEqual(r.url, 'http://localhost:9/u');
  assert.deepStrictEqual(r.headers, { 'X-Token': 'abc', 'Content-Type': 'application/json' });
  assert.strictEqual(C.build({ method: 'GET', url: 'http://x/', body: 'ignored' }).body, undefined);
  assert.throws(() => C.build({ url: 'ftp://x/' }), /http/);
  assert.throws(() => C.build({ url: 'not a url' }), /valid address/);
});

test('curl in: bash with line breaks, quotes, -u, --json; PowerShell backticks; pasted on one line', () => {
  const r = C.parseCurl(`curl -X PUT 'https://api.example.com/items/1' \\\n  -H 'Content-Type: application/json' \\\n  -H "Authorization: Bearer x y" \\\n  -d '{"name":"it\\'s"}'`);
  assert.strictEqual(r.method, 'PUT'); assert.strictEqual(r.url, 'https://api.example.com/items/1');
  assert.deepStrictEqual(r.headers[1], ['Authorization', 'Bearer x y']);
  assert.strictEqual(r.bodyType, 'json');
  const p = C.parseCurl('curl.exe -s https://x.dev/a ` -u alex:pw ` --json \'{"a":1}\'');
  assert.strictEqual(p.method, 'POST'); assert.strictEqual(p.url, 'https://x.dev/a');
  assert.ok(p.headers.some(([k, v]) => k === 'Authorization' && v === `Basic ${Buffer.from('alex:pw').toString('base64')}`));
  const one = C.parseCurl("curl -X POST \\ -H 'A: b' \\ https://h/x \\ --data-urlencode 'q=1 2'");
  assert.strictEqual(one.url, 'https://h/x'); assert.strictEqual(one.bodyType, 'form');
  assert.throws(() => C.parseCurl('wget x'), /curl/);
});

test('curl out and back gives the same request', () => {
  const req = { method: 'POST', url: '{{b}}/x', headers: [['A', "it's"]], body: '{"q":"x y"}', bodyType: 'json' };
  const cmd = C.toCurl(req, { b: 'http://localhost:8080' });
  const back = C.parseCurl(cmd);
  assert.strictEqual(back.url, 'http://localhost:8080/x'); assert.strictEqual(back.body, '{"q":"x y"}');
  assert.ok(back.headers.some(([k, v]) => k === 'A' && v === "it's"));
});

test('send: status, time, size, headers, JSON; error when nothing answers', async () => {
  const srv = http.createServer((q, res) => { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ method: q.method, got: b, h: q.headers['x-k'] })); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const r = await C.send({ method: 'POST', url: '{{base}}/echo', headers: [['X-K', 'v']], body: '{"a":1}' }, { base: `http://127.0.0.1:${port}` });
  srv.close();
  assert.strictEqual(r.status, 200); assert.ok(r.ms >= 0 && r.size > 10);
  assert.deepStrictEqual(JSON.parse(r.body), { method: 'POST', got: '{"a":1}', h: 'v' });
  const bad = await C.send({ url: 'http://127.0.0.1:1/' }, {}, { timeoutMs: 3000 });
  assert.ok(bad.error && /answers|time|ECONN/i.test(bad.error), bad.error);
});

test('collections from the client are cleaned', () => {
  const c = C.cleanCollections([{ name: 'A'.repeat(200), vars: [['k', 'v']], requests: [{ method: 'BOGUS', url: 'x', headers: [['a', 'b']], bodyType: 'xml' }] }, 'junk']);
  assert.strictEqual(c[0].name.length, 80); assert.strictEqual(c[0].requests[0].method, 'GET'); assert.strictEqual(c[0].requests[0].bodyType, 'json');
});

test('every server message has German', () => {
  for (const s of ['That is not a valid address (it must start with http:// or https://).', 'Please paste a command that starts with curl.', 'No answer within the time limit.', 'Nothing answers at this address – is the server running?']) assert.ok(de[s], s);
});
