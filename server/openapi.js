'use strict';
/*
 * OpenAPI 3.x / Swagger 2.0 → API tester collection (without Hostwerk, so the tests can run it directly).
 *   fromOpenApi(doc, { uid }) → { id, name, vars: [['base', url], …], requests: [{ id, name, method, url, headers, body, bodyType }] }
 * Every operation becomes one request: path parameters become variables ({{petId}}), required query parameters are filled
 * with their example (or an empty value), a JSON body is built from the example or the schema. Security schemes add a
 * header with a variable ({{token}}, {{apiKey}}) – the user fills it once in the collection's variables.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const MAX_OPS = 500;

/** Follow a local $ref (#/components/schemas/Pet, #/definitions/Pet). Unknown or remote refs stay empty. */
function deref(doc, node, seen = new Set()) {
  if (!node || typeof node !== 'object' || !node.$ref) return node;
  const ref = String(node.$ref);
  if (!ref.startsWith('#/') || seen.has(ref)) return {};
  seen.add(ref);
  let cur = doc;
  for (const part of ref.slice(2).split('/')) { cur = cur && cur[part.replace(/~1/g, '/').replace(/~0/g, '~')]; if (cur === undefined) return {}; }
  return deref(doc, cur, seen);
}

/** Example value for a schema: example → default → enum[0] → built from type (objects and arrays a few levels deep). */
function sample(doc, schema, depth = 0) {
  const s = deref(doc, schema) || {};
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (depth > 4) return null;
  const pick = s.allOf || s.oneOf || s.anyOf;
  if (Array.isArray(pick) && pick.length) {
    if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => { const v = sample(doc, x, depth + 1); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }));
    return sample(doc, pick[0], depth + 1);
  }
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type || (s.properties ? 'object' : s.items ? 'array' : null);
  if (type === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(s.properties || {}).slice(0, 30)) { if (deref(doc, v).readOnly) continue; out[k] = sample(doc, v, depth + 1); }
    return out;
  }
  if (type === 'array') { const v = sample(doc, s.items || {}, depth + 1); return v === null || v === undefined ? [] : [v]; }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') {
    if (s.format === 'date-time') return '2026-01-01T12:00:00Z';
    if (s.format === 'date') return '2026-01-01';
    if (s.format === 'email') return 'name@example.com';
    if (s.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
    if (s.format === 'uri' || s.format === 'url') return 'https://example.com';
    return '';
  }
  return null;
}

/** Base URL: OpenAPI 3 servers[0] (with variables filled) or Swagger 2 schemes/host/basePath. */
function baseUrl(doc, fallback) {
  if (Array.isArray(doc.servers) && doc.servers.length && doc.servers[0].url) {
    const sv = doc.servers[0];
    let u = String(sv.url).replace(/\{(\w+)\}/g, (m, k) => (sv.variables && sv.variables[k] && sv.variables[k].default !== undefined ? String(sv.variables[k].default) : m));
    if (u.startsWith('/') && fallback) { try { u = new URL(u, fallback).toString(); } catch { /* lassen */ } }
    return u.replace(/\/$/, '');
  }
  if (doc.swagger && doc.host) return `${(doc.schemes && doc.schemes[0]) || 'https'}://${doc.host}${doc.basePath && doc.basePath !== '/' ? doc.basePath : ''}`.replace(/\/$/, '');
  if (fallback) { try { const u = new URL(fallback); return `${u.protocol}//${u.host}`; } catch { /* lassen */ } }
  return 'http://localhost';
}

/** Headers from the security schemes the operation (or the whole API) uses. Adds the variables it needs to vars. */
function securityHeaders(doc, op, vars) {
  const schemes = (doc.components && doc.components.securitySchemes) || doc.securityDefinitions || {};
  const req = op.security || doc.security || [];
  const headers = []; const query = [];
  for (const entry of req) {
    for (const name of Object.keys(entry || {})) {
      const s = schemes[name];
      if (!s) continue;
      if ((s.type === 'http' && /^bearer$/i.test(s.scheme || '')) || s.type === 'oauth2' || s.type === 'openIdConnect') { headers.push(['Authorization', 'Bearer {{token}}']); vars.set('token', ''); }
      else if (s.type === 'http' && /^basic$/i.test(s.scheme || '')) { headers.push(['Authorization', 'Basic {{basicAuth}}']); vars.set('basicAuth', ''); }
      else if (s.type === 'basic') { headers.push(['Authorization', 'Basic {{basicAuth}}']); vars.set('basicAuth', ''); }
      else if (s.type === 'apiKey' && s.name) {
        const v = s.name.replace(/[^\w.-]/g, '');
        if (s.in === 'query') query.push(`${encodeURIComponent(s.name)}={{${v}}}`); else if (s.in === 'header') headers.push([s.name, `{{${v}}}`]);
        vars.set(v, '');
      }
    }
    if (headers.length || query.length) break; // eine erfüllbare Variante reicht
  }
  return { headers, query };
}

function fromOpenApi(doc, { uid = () => Math.random().toString(36).slice(2, 10), source = '' } = {}) {
  if (!doc || typeof doc !== 'object' || !(doc.openapi || doc.swagger) || typeof doc.paths !== 'object') throw Object.assign(new Error('This is not an OpenAPI or Swagger description (it needs "openapi"/"swagger" and "paths").'), { status: 400 });
  const vars = new Map([['base', baseUrl(doc, source)]]);
  const requests = [];
  for (const [p, item0] of Object.entries(doc.paths)) {
    const item = deref(doc, item0) || {};
    for (const m of METHODS) {
      if (!item[m] || requests.length >= MAX_OPS) continue;
      const op = item[m];
      const params = [...(item.parameters || []), ...(op.parameters || [])].map((x) => deref(doc, x)).filter((x) => x && x.name);
      let url = `{{base}}${p.replace(/\{([\w.-]+)\}/g, (mm, k) => { vars.set(k, vars.get(k) || ''); return `{{${k}}}`; })}`;
      const q = []; const headers = [];
      for (const prm of params) {
        const ex = prm.example !== undefined ? prm.example : prm.schema ? sample(doc, prm.schema) : prm.default !== undefined ? prm.default : '';
        if (prm.in === 'query' && prm.required) q.push(`${encodeURIComponent(prm.name)}=${encodeURIComponent(ex === null || typeof ex === 'object' ? '' : String(ex))}`);
        if (prm.in === 'header' && !/^(authorization|content-type|accept)$/i.test(prm.name)) headers.push([prm.name, ex === null || typeof ex === 'object' ? '' : String(ex)]);
      }
      const sec = securityHeaders(doc, op, vars);
      headers.unshift(...sec.headers);
      q.push(...sec.query);
      if (q.length) url += `?${q.join('&')}`;
      // Body: OpenAPI 3 requestBody (JSON bevorzugt, sonst Formular), Swagger 2 Parameter „in: body“/„formData“
      let body = ''; let bodyType = 'json';
      const rb = deref(doc, op.requestBody);
      if (rb && rb.content) {
        const types = Object.keys(rb.content);
        const jt = types.find((t) => /json/i.test(t));
        const ft = types.find((t) => /x-www-form-urlencoded/i.test(t));
        if (jt) { const c = rb.content[jt]; const ex = c.example !== undefined ? c.example : c.examples ? Object.values(c.examples).map((x) => deref(doc, x).value).find((x) => x !== undefined) : sample(doc, c.schema || {}); body = JSON.stringify(ex === undefined ? {} : ex, null, 2); }
        else if (ft) { const v = sample(doc, rb.content[ft].schema || {}); bodyType = 'form'; body = v && typeof v === 'object' ? new URLSearchParams(Object.entries(v).map(([k, x]) => [k, x === null || typeof x === 'object' ? '' : String(x)])).toString() : ''; }
        else if (types.length) { bodyType = 'text'; body = ''; }
      } else {
        const bp = params.find((x) => x.in === 'body');
        const fp = params.filter((x) => x.in === 'formData');
        if (bp) body = JSON.stringify(sample(doc, bp.schema || {}) ?? {}, null, 2);
        else if (fp.length) { bodyType = 'form'; body = new URLSearchParams(fp.map((x) => [x.name, x.default !== undefined ? String(x.default) : ''])).toString(); }
      }
      // Gruppe (erster Tag) vor den Namen – die Sammlung kennt keine Ordner, so bleiben zusammengehörige Anfragen beieinander
      const tag = Array.isArray(op.tags) && op.tags.length ? String(op.tags[0]).slice(0, 30) : '';
      const name = `${tag ? `${tag}: ` : ''}${String(op.summary || op.operationId || `${m.toUpperCase()} ${p}`).replace(/\s+/g, ' ').trim()}`.slice(0, 110);
      requests.push({ id: uid(), name, method: m.toUpperCase(), url, headers, body: ['get', 'head'].includes(m) ? '' : body, bodyType });
    }
  }
  if (!requests.length) throw Object.assign(new Error('The description has no operations (paths without get/post/…).'), { status: 400 });
  const title = String((doc.info && doc.info.title) || 'API').slice(0, 60);
  return { id: uid(), name: `${title}${doc.info && doc.info.version ? ` ${String(doc.info.version).slice(0, 12)}` : ''}`, vars: [...vars.entries()], requests };
}

/** Text (JSON or YAML) → document. parseYaml comes from Hostwerk (host.lib('yaml').parse). */
function parseDoc(text, parseYaml) {
  const s = String(text || '').trim();
  if (!s) throw Object.assign(new Error('Paste an OpenAPI description or enter its address.'), { status: 400 });
  if (s.length > 5 * 1024 * 1024) throw Object.assign(new Error('The description is larger than 5 MB.'), { status: 413 });
  if (s.startsWith('{')) { try { return JSON.parse(s); } catch { throw Object.assign(new Error('The JSON could not be read.'), { status: 400 }); } }
  if (!parseYaml) throw Object.assign(new Error('YAML cannot be read here – please use the JSON version.'), { status: 400 });
  try { return parseYaml(s); } catch (e) { throw Object.assign(new Error(`The YAML could not be read (${String(e.message).split('\n')[0]}).`), { status: 400 }); }
}

module.exports = { fromOpenApi, parseDoc, sample, baseUrl };
