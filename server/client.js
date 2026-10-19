'use strict';
/*
 * API tester logic without Hostwerk: variables, curl in/out, sending a request and shaping the response.
 * Kept separate so the tests can run it directly (node --test tests/*.test.js).
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_BODY = 2 * 1024 * 1024; // responses larger than this are cut (the tester is not a download tool)

/** {{name}} → value from vars (unknown names stay visible, so a typo is easy to spot). */
function fill(text, vars = {}) {
  return String(text == null ? '' : text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/** Request as saved in a collection → ready to send (variables filled, headers as object, body as string). */
function build(req, vars = {}) {
  const method = METHODS.includes(String(req.method || 'GET').toUpperCase()) ? String(req.method).toUpperCase() : 'GET';
  const url = fill(req.url, vars).trim();
  let u;
  try { u = new URL(url); } catch { throw Object.assign(new Error('That is not a valid address (it must start with http:// or https://).'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Only http:// and https:// addresses are supported.'), { status: 400 });
  const headers = {};
  for (const [k, v] of Array.isArray(req.headers) ? req.headers : []) if (k && String(k).trim() && v !== undefined && !/^#/.test(k)) headers[fill(k, vars).trim()] = fill(v, vars);
  let body;
  if (!['GET', 'HEAD'].includes(method) && req.body != null && String(req.body) !== '') {
    body = fill(req.body, vars);
    const type = req.bodyType || 'json';
    const has = (h) => Object.keys(headers).some((x) => x.toLowerCase() === h);
    if (type === 'json' && !has('content-type')) headers['Content-Type'] = 'application/json';
    if (type === 'form' && !has('content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (type === 'text' && !has('content-type')) headers['Content-Type'] = 'text/plain; charset=utf-8';
  }
  return { method, url: u.toString(), headers, body };
}

/** Split a shell command line into words (single/double quotes, backslash line continuations). */
function words(cmd) {
  // Line continuations (bash \, cmd ^, PowerShell `) – also when the line breaks were already lost while pasting
  const s = String(cmd || '').replace(/[\\^`][ \t]*\r?\n/g, ' ').replace(/(^|\s)[\\^`](?=\s)/g, '$1');
  const out = []; let cur = ''; let q = null; let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    cur += c; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** curl command → request { method, url, headers:[[k,v]], body, bodyType }. */
function parseCurl(cmd) {
  const w = words(cmd);
  if (!w.length || !/^curl(\.exe)?$/i.test(w[0])) throw Object.assign(new Error('Please paste a command that starts with curl.'), { status: 400 });
  const r = { method: null, url: '', headers: [], body: '', bodyType: 'json' };
  for (let i = 1; i < w.length; i++) {
    const a = w[i];
    if (a === '-X' || a === '--request') r.method = String(w[++i] || '').toUpperCase();
    else if (a === '-H' || a === '--header') { const h = String(w[++i] || ''); const k = h.indexOf(':'); if (k > 0) r.headers.push([h.slice(0, k).trim(), h.slice(k + 1).trim()]); }
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--json'].includes(a)) { r.body = r.body ? `${r.body}&${w[++i]}` : String(w[++i] || ''); if (a === '--json') r.headers.push(['Content-Type', 'application/json']); }
    else if (a === '--data-urlencode') { r.body = r.body ? `${r.body}&${w[++i]}` : String(w[++i] || ''); r.bodyType = 'form'; }
    else if (a === '-u' || a === '--user') r.headers.push(['Authorization', `Basic ${Buffer.from(String(w[++i] || '')).toString('base64')}`]);
    else if (a === '-A' || a === '--user-agent') r.headers.push(['User-Agent', String(w[++i] || '')]);
    else if (a === '-b' || a === '--cookie') r.headers.push(['Cookie', String(w[++i] || '')]);
    else if (a === '--url') r.url = String(w[++i] || '');
    else if (/^https?:\/\//i.test(a) && !r.url) r.url = a;
    else if (/^-/.test(a)) { /* flags without value we do not need: -s, -L, -k, -i, --compressed … */ }
    else if (!r.url) r.url = a;
  }
  const ct = (r.headers.find(([k]) => k.toLowerCase() === 'content-type') || [])[1] || '';
  if (/x-www-form-urlencoded/i.test(ct)) r.bodyType = 'form';
  else if (r.bodyType === 'json' && r.body && !/json/i.test(ct) && !/^\s*[[{]/.test(r.body)) r.bodyType = 'text';
  r.method = r.method || (r.body ? 'POST' : 'GET');
  if (!r.url) throw Object.assign(new Error('The curl command has no address.'), { status: 400 });
  return r;
}

const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
/** Request → curl command (works in bash, Git Bash and PowerShell 7). */
function toCurl(req, vars = {}) {
  const b = build(req, vars);
  const parts = ['curl'];
  if (b.method !== 'GET') parts.push('-X', b.method);
  for (const [k, v] of Object.entries(b.headers)) parts.push('-H', sq(`${k}: ${v}`));
  if (b.body !== undefined) parts.push('--data-raw', sq(b.body));
  parts.push(sq(b.url));
  return parts.join(' ');
}

/** Send and shape the answer: { status, statusText, ms, size, headers, body, base64, cut, contentType }. */
async function send(req, vars = {}, { fetchFn = fetch, timeoutMs = 30000 } = {}) {
  const b = build(req, vars);
  const t0 = Date.now();
  let res;
  try {
    res = await fetchFn(b.url, { method: b.method, headers: b.headers, body: b.body, redirect: 'manual', signal: AbortSignal.timeout(Math.min(Math.max(Number(timeoutMs) || 30000, 1000), 120000)) });
  } catch (e) {
    const msg = e && e.name === 'TimeoutError' ? 'No answer within the time limit.' : /ECONNREFUSED|fetch failed/i.test(String(e && (e.cause && e.cause.code || e.message))) ? 'Nothing answers at this address – is the server running?' : String(e && e.message || e);
    return { error: msg, ms: Date.now() - t0, request: b };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Date.now() - t0;
  const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
  const contentType = headers['content-type'] || '';
  const textual = !contentType || /json|text|xml|javascript|html|csv|yaml|x-www-form-urlencoded/i.test(contentType);
  const cut = buf.length > MAX_BODY;
  const part = cut ? buf.subarray(0, MAX_BODY) : buf;
  return { status: res.status, statusText: res.statusText, ms, size: buf.length, headers, contentType, cut, body: textual ? part.toString('utf8') : part.toString('base64'), base64: !textual, request: b };
}

/** Collections from the client: keep only what we expect (names, requests, variables). */
function cleanCollections(list) {
  const str = (v, n = 4000) => String(v == null ? '' : v).slice(0, n);
  return (Array.isArray(list) ? list : []).slice(0, 200).map((c) => ({
    id: str(c.id, 40) || Math.random().toString(36).slice(2, 10),
    name: str(c.name, 80) || 'Collection',
    vars: (Array.isArray(c.vars) ? c.vars : []).slice(0, 100).map(([k, v]) => [str(k, 80), str(v, 2000)]),
    requests: (Array.isArray(c.requests) ? c.requests : []).slice(0, 500).map((r) => ({
      id: str(r.id, 40) || Math.random().toString(36).slice(2, 10), name: str(r.name, 120) || 'Request',
      method: METHODS.includes(String(r.method).toUpperCase()) ? String(r.method).toUpperCase() : 'GET',
      url: str(r.url, 4000), headers: (Array.isArray(r.headers) ? r.headers : []).slice(0, 100).map(([k, v]) => [str(k, 200), str(v, 8000)]),
      body: str(r.body, 1024 * 1024), bodyType: ['json', 'form', 'text'].includes(r.bodyType) ? r.bodyType : 'json',
    })),
  }));
}

module.exports = { METHODS, fill, build, words, parseCurl, toCurl, send, cleanCollections };
