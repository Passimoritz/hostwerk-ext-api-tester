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
  if (!['GET', 'HEAD'].includes(method) && req.bodyType === 'multipart') {
    // Formular mit Feldern und Dateien (multipart/form-data) – Dateien liest send() über readFile
    const fields = (Array.isArray(req.form) ? req.form : []).filter(([k]) => k && String(k).trim()).map(([k, v, type]) => ({ name: fill(k, vars).trim(), value: fill(v, vars), file: type === 'file' }));
    for (const k of Object.keys(headers)) if (k.toLowerCase() === 'content-type') delete headers[k]; // die Grenze setzt fetch selbst
    return { method, url: u.toString(), headers, body: undefined, form: fields };
  }
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
async function send(req, vars = {}, { fetchFn = fetch, timeoutMs = 30000, signal = null, readFile = null, cookies = null } = {}) {
  const b = build(req, vars);
  const o = req.options || {};
  // Zeitlimit: eigenes je Anfrage (Sekunden) vor dem allgemeinen; 1 s bis 10 min
  const limit = Math.min(Math.max((Number(o.timeout) > 0 ? Number(o.timeout) * 1000 : Number(timeoutMs)) || 30000, 1000), 600000);
  const signals = [AbortSignal.timeout(limit), ...(signal ? [signal] : [])];
  const sendHeaders = { ...b.headers };
  // Cookies aus der Sammlung (falls eingeschaltet) – eigener Cookie-Kopf hat Vorrang
  const jar = cookies ? cookieHeader(cookies, b.url) : '';
  if (jar && !Object.keys(sendHeaders).some((k) => k.toLowerCase() === 'cookie')) sendHeaders.Cookie = jar;
  let body = b.body;
  if (b.form) {
    const fd = new FormData();
    for (const x of b.form) {
      if (!x.file) { fd.append(x.name, x.value); continue; }
      if (!readFile) throw Object.assign(new Error('Files cannot be sent here.'), { status: 400 });
      const file = await readFile(x.value);
      fd.append(x.name, new Blob([file.data], { type: file.type || 'application/octet-stream' }), file.name);
    }
    body = fd;
  }
  const t0 = Date.now();
  let res;
  try {
    res = await fetchFn(b.url, { method: b.method, headers: sendHeaders, body, redirect: o.follow ? 'follow' : 'manual', signal: AbortSignal.any(signals) });
  } catch (e) {
    const aborted = signal && signal.aborted;
    const msg = aborted ? 'Cancelled.' : e && e.name === 'TimeoutError' ? 'No answer within the time limit.' : /ECONNREFUSED|fetch failed/i.test(String(e && (e.cause && e.cause.code || e.message))) ? 'Nothing answers at this address – is the server running?' : String(e && e.message || e);
    return { error: msg, cancelled: !!aborted, ms: Date.now() - t0, request: b };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Date.now() - t0;
  const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
  const contentType = headers['content-type'] || '';
  const textual = !contentType || /json|text|xml|javascript|html|csv|yaml|x-www-form-urlencoded/i.test(contentType);
  const cut = buf.length > MAX_BODY;
  const part = cut ? buf.subarray(0, MAX_BODY) : buf;
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (headers['set-cookie'] ? [headers['set-cookie']] : []);
  return { status: res.status, statusText: res.statusText, ms, size: buf.length, headers, contentType, cut, body: textual ? part.toString('utf8') : part.toString('base64'), base64: !textual, request: b, url: res.url || b.url, redirected: !!res.redirected, setCookies };
}

/* ---------------- Cookies (je Sammlung, auf Wunsch) ---------------- */
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
/** Set-Cookie-Zeilen einer Antwort in den Cookie-Speicher der Sammlung: { host: { name: value } } (abgelaufene fliegen raus). */
function storeCookies(jar, url, lines) {
  const host = hostOf(url);
  if (!host) return jar;
  const out = { ...(jar || {}) };
  const mine = { ...(out[host] || {}) };
  for (const line of lines || []) {
    const [pair, ...attrs] = String(line).split(';');
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const name = pair.slice(0, i).trim(); const value = pair.slice(i + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age\s*=\s*(0|-\d+)/i.test(a) || (/^\s*expires\s*=/i.test(a) && Date.parse(a.split('=').slice(1).join('=')) < Date.now()));
    if (expired || value === '') delete mine[name]; else mine[name] = value.slice(0, 4000);
  }
  out[host] = mine;
  if (!Object.keys(mine).length) delete out[host];
  return out;
}
/** Cookie-Kopf für eine Adresse (gleicher Host oder übergeordnete Domain). */
function cookieHeader(jar, url) {
  const host = hostOf(url);
  const parts = [];
  for (const [h, list] of Object.entries(jar || {})) if (host === h || host.endsWith(`.${h}`)) for (const [k, v] of Object.entries(list)) parts.push(`${k}=${v}`);
  return parts.join('; ');
}

/* ---------------- Geheimnisse ---------------- */
const SECRET_NAME = /token|secret|passw|pwd|api[-_]?key|apikey|auth|session|cookie|private|credential|bearer/i;
const MASK = '••••••';
/** Kopfzeilen, die nie im Klartext im Verlauf landen. */
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api-key|x-access-token)$|token|secret|passw|api[-_]?key/i;
/** Variable geheim? Ausdrücklich markiert oder Name wie token/secret/password/api_key. */
const isSecretVar = (row) => (row && row[2] === true) || (row && row[2] !== false && SECRET_NAME.test(String(row[0] || '')));
/** Anfrage für den Verlauf: geheime Kopfzeilen, Formularwerte und Basic-Auth geschwärzt. */
function redactRequest(r) {
  const x = { ...(r || {}) };
  x.headers = (Array.isArray(x.headers) ? x.headers : []).map(([k, v]) => [k, SECRET_HEADER.test(String(k)) && !/^\s*\{\{[\w.-]+\}\}\s*$/.test(String(v)) ? MASK : v]);
  if (Array.isArray(x.form)) x.form = x.form.map(([k, v, t]) => [k, SECRET_NAME.test(String(k)) ? MASK : v, t]);
  if (typeof x.url === 'string') x.url = redactUrl(x.url);
  return x;
}
/** Adresse für den Verlauf: Passwort in der Adresse und Werte geheimer Parameter (?token=…) geschwärzt. */
function redactUrl(url) {
  let s = String(url || '').replace(/(:\/\/[^/\s:@]+:)[^/\s@]+@/, `$1${MASK}@`);
  s = s.replace(/([?&])([^=&#]+)=([^&#]*)/g, (m, sep, k, v) => (SECRET_NAME.test(decodeURIComponent(k)) && v && !/^\{\{[\w.-]+\}\}$/.test(v) ? `${sep}${k}=${MASK}` : m));
  return s;
}
/** Kopfzeilen-Objekt (gesendet) für den Verlauf schwärzen. */
const redactHeaders = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k, SECRET_HEADER.test(k) ? MASK : v]));

/* ---------------- Umgebungen ---------------- */
/**
 * Werte für {{name}}: Variablen der Sammlung, darüber die der gewählten Umgebung (lokal, Staging, live …).
 * envId = gewählte Umgebung (sonst die aktive der Sammlung).
 */
function varsFor(col, envId) {
  const out = {};
  for (const [k, v] of (col && col.vars) || []) if (k) out[k] = v;
  const env = ((col && col.envs) || []).find((e) => e.id === (envId || col.env));
  if (env) for (const [k, v] of env.vars || []) if (k) out[k] = v;
  return out;
}

/* ---------------- Prüfungen ---------------- */
/** Wert aus JSON per Pfad: data.items[0].id */
function jsonPath(obj, p) {
  let cur = obj;
  for (const part of String(p || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) { if (cur == null) return undefined; cur = cur[part]; }
  return cur;
}
/**
 * Prüfungen einer Anfrage gegen die Antwort: { kind: status|json|header|body|time, path, op: eq|ne|contains|exists|lt|gt, value }
 * → [{ …check, ok, actual }]
 */
function runChecks(checks, r) {
  let json;
  const parsed = () => { if (json === undefined) { try { json = JSON.parse(r.body); } catch { json = null; } } return json; };
  return (Array.isArray(checks) ? checks : []).map((c) => {
    let actual;
    if (r.error) actual = undefined;
    else if (c.kind === 'status') actual = r.status;
    else if (c.kind === 'time') actual = r.ms;
    else if (c.kind === 'header') actual = (r.headers || {})[String(c.path || '').toLowerCase()];
    else if (c.kind === 'body') actual = typeof r.body === 'string' ? r.body : '';
    else actual = jsonPath(parsed(), c.path);
    const want = c.value;
    const num = (x) => Number(x);
    let ok;
    switch (c.op) {
      case 'exists': ok = actual !== undefined && actual !== null; break;
      case 'ne': ok = String(actual) !== String(want); break;
      case 'contains': ok = actual != null && (typeof actual === 'object' ? JSON.stringify(actual) : String(actual)).includes(String(want)); break;
      case 'lt': ok = actual != null && num(actual) < num(want); break;
      case 'gt': ok = actual != null && num(actual) > num(want); break;
      default: ok = actual != null && (typeof actual === 'object' ? JSON.stringify(actual) : String(actual)) === String(want);
    }
    const shown = actual === undefined ? undefined : typeof actual === 'object' ? JSON.stringify(actual).slice(0, 200) : String(actual).slice(0, 200);
    return { ...c, ok: !!ok, actual: shown };
  });
}

/** Collections from the client: keep only what we expect (names, requests, variables). */
const KINDS = ['status', 'json', 'header', 'body', 'time'];
const OPS = ['eq', 'ne', 'contains', 'exists', 'lt', 'gt'];
function cleanCollections(list) {
  const str = (v, n = 4000) => String(v == null ? '' : v).slice(0, n);
  const rid = () => Math.random().toString(36).slice(2, 10);
  // Variable: [Name, Wert, geheim?] – geheim: ausdrücklich gesetzt oder am Namen erkannt
  const vars = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 100).filter(Array.isArray).map(([k, v, secret]) => [str(k, 80), str(v, 2000), typeof secret === 'boolean' ? secret : SECRET_NAME.test(String(k || ''))]);
  return (Array.isArray(list) ? list : []).slice(0, 200).map((c) => ({
    id: str(c.id, 40) || rid(),
    name: str(c.name, 80) || 'Collection',
    vars: vars(c.vars),
    // Umgebungen (lokal, Staging, live …): eigene Variablen, die die der Sammlung überschreiben
    envs: (Array.isArray(c.envs) ? c.envs : []).slice(0, 20).map((e) => ({ id: str(e && e.id, 40) || rid(), name: str(e && e.name, 40) || 'Environment', vars: vars(e && e.vars) })),
    env: str(c.env, 40) || null,
    cookieJar: c.cookieJar === true,
    cookies: c.cookies && typeof c.cookies === 'object' && !Array.isArray(c.cookies) ? Object.fromEntries(Object.entries(c.cookies).slice(0, 50).map(([h, l]) => [str(h, 200), Object.fromEntries(Object.entries(l || {}).slice(0, 50).map(([k, v]) => [str(k, 200), str(v, 4000)]))])) : {},
    runToken: /^[a-f0-9]{32}$/.test(c.runToken || '') ? c.runToken : null,
    requests: (Array.isArray(c.requests) ? c.requests : []).slice(0, 500).map((r) => ({
      id: str(r.id, 40) || rid(), name: str(r.name, 120) || 'Request',
      folder: str(r.folder, 200).split('/').map((x) => x.trim()).filter(Boolean).join('/'),
      method: METHODS.includes(String(r.method).toUpperCase()) ? String(r.method).toUpperCase() : 'GET',
      url: str(r.url, 4000), headers: (Array.isArray(r.headers) ? r.headers : []).slice(0, 100).map(([k, v]) => [str(k, 200), str(v, 8000)]),
      body: str(r.body, 1024 * 1024), bodyType: ['json', 'form', 'text', 'multipart'].includes(r.bodyType) ? r.bodyType : 'json',
      form: (Array.isArray(r.form) ? r.form : []).slice(0, 100).filter(Array.isArray).map(([k, v, t]) => [str(k, 200), str(v, 8000), t === 'file' ? 'file' : 'text']),
      options: { follow: !!(r.options && r.options.follow), timeout: Math.max(0, Math.min(600, Number(r.options && r.options.timeout) || 0)) },
      checks: (Array.isArray(r.checks) ? r.checks : []).slice(0, 30).map((x) => ({ kind: KINDS.includes(x && x.kind) ? x.kind : 'status', path: str(x && x.path, 200), op: OPS.includes(x && x.op) ? x.op : 'eq', value: str(x && x.value, 2000) })),
    })),
  }));
}

module.exports = { METHODS, MASK, fill, build, words, parseCurl, toCurl, send, cleanCollections, storeCookies, cookieHeader, isSecretVar, redactRequest, redactHeaders, redactUrl, varsFor, jsonPath, runChecks };
