'use strict';
/*
 * Collections from other tools and back: Postman (collection v2.0/v2.1, folders become folders), Insomnia (export v4/v5,
 * request groups become folders, environments become environments) and Postman v2.1 as export.
 * OpenAPI/Swagger stays in openapi.js – detect() picks the right reader.
 */
const O = require('./openapi');

const rid = () => Math.random().toString(36).slice(2, 10);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const method = (m) => (METHODS.includes(String(m || 'GET').toUpperCase()) ? String(m).toUpperCase() : 'GET');
// Postman/Insomnia write {{name}} like we do; Insomnia also {{ _.name }}
const vars = (s) => String(s == null ? '' : s).replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, '{{$1}}');

/** Body type and text from a Postman body. */
function postmanBody(b) {
  if (!b || !b.mode) return { body: '', bodyType: 'json' };
  if (b.mode === 'raw') {
    const lang = b.options && b.options.raw && b.options.raw.language;
    return { body: vars(b.raw), bodyType: lang && lang !== 'json' ? 'text' : /^\s*[[{]/.test(b.raw || '') || !b.raw ? 'json' : 'text' };
  }
  if (b.mode === 'urlencoded') return { body: (b.urlencoded || []).filter((x) => !x.disabled).map((x) => `${encodeURIComponent(x.key)}=${encodeURIComponent(vars(x.value))}`).join('&'), bodyType: 'form' };
  if (b.mode === 'formdata') return { body: '', bodyType: 'multipart', form: (b.formdata || []).filter((x) => !x.disabled).map((x) => [x.key, x.type === 'file' ? String(x.src || '') : vars(x.value), x.type === 'file' ? 'file' : 'text']) };
  if (b.mode === 'graphql') return { body: JSON.stringify({ query: (b.graphql || {}).query || '', variables: (b.graphql || {}).variables ? JSON.parse((b.graphql || {}).variables || '{}') : undefined }), bodyType: 'json' };
  return { body: '', bodyType: 'json' };
}

/** Postman collection (v2.0 / v2.1) → our collection. */
function fromPostman(j) {
  const info = j.info || {};
  const out = { id: rid(), name: String(info.name || 'Postman').slice(0, 80), vars: (j.variable || []).filter((v) => v && v.key).map((v) => [String(v.key), vars(v.value)]), envs: [], requests: [] };
  const walk = (items, folder) => {
    for (const it of items || []) {
      if (Array.isArray(it.item)) { walk(it.item, folder ? `${folder}/${it.name}` : String(it.name || '')); continue; }
      const r = it.request;
      if (!r) continue;
      const req = typeof r === 'string' ? { url: r } : r;
      const url = typeof req.url === 'string' ? req.url : (req.url && (req.url.raw || [req.url.protocol ? `${req.url.protocol}://` : '', [].concat(req.url.host || []).join('.'), req.url.path ? `/${[].concat(req.url.path).join('/')}` : ''].join(''))) || '';
      const headers = (req.header || []).filter((h) => h && !h.disabled && h.key).map((h) => [String(h.key), vars(h.value)]);
      // Postman's own auth → Authorization header (bearer, basic) – other kinds stay as a note in the name
      const a = req.auth;
      if (a && a.type === 'bearer') { const tok = (a.bearer || []).find((x) => x.key === 'token'); if (tok) headers.push(['Authorization', `Bearer ${vars(tok.value)}`]); }
      if (a && a.type === 'basic') { const u = (a.basic || []).find((x) => x.key === 'username'); const p = (a.basic || []).find((x) => x.key === 'password'); headers.push(['Authorization', `Basic ${Buffer.from(`${u ? u.value : ''}:${p ? p.value : ''}`).toString('base64')}`]); }
      out.requests.push({ id: rid(), name: String(it.name || `${method(req.method)} ${url}`).slice(0, 120), folder: folder || '', method: method(req.method), url: vars(url), headers, ...postmanBody(req.body) });
    }
  };
  walk(j.item, '');
  return out;
}

/** Insomnia export (v4 JSON; v5 YAML parsed by the caller) → our collection(s, one per workspace – here: the first). */
function fromInsomnia(j) {
  const res = Array.isArray(j.resources) ? j.resources : [];
  const ws = res.find((x) => x._type === 'workspace') || {};
  const byId = new Map(res.map((x) => [x._id, x]));
  const folderOf = (parentId) => { const parts = []; let p = byId.get(parentId); while (p && p._type === 'request_group') { parts.unshift(p.name); p = byId.get(p.parentId); } return parts.join('/'); };
  const out = { id: rid(), name: String(ws.name || 'Insomnia').slice(0, 80), vars: [], envs: [], requests: [] };
  for (const e of res.filter((x) => x._type === 'environment')) {
    const data = Object.entries(e.data || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, String(v)]);
    if (byId.get(e.parentId) && byId.get(e.parentId)._type === 'workspace') out.vars.push(...data); // base environment
    else out.envs.push({ id: rid(), name: String(e.name || 'Environment').slice(0, 40), vars: data });
  }
  for (const r of res.filter((x) => x._type === 'request')) {
    const b = r.body || {};
    let body = ''; let bodyType = 'json'; let form;
    if (b.mimeType === 'application/x-www-form-urlencoded') { body = (b.params || []).filter((x) => !x.disabled).map((x) => `${encodeURIComponent(x.name)}=${encodeURIComponent(vars(x.value))}`).join('&'); bodyType = 'form'; }
    else if (b.mimeType === 'multipart/form-data') { bodyType = 'multipart'; form = (b.params || []).filter((x) => !x.disabled).map((x) => [x.name, x.type === 'file' ? String(x.fileName || '') : vars(x.value), x.type === 'file' ? 'file' : 'text']); }
    else if (b.text != null) { body = vars(b.text); bodyType = /json/.test(b.mimeType || 'json') ? 'json' : 'text'; }
    const headers = (r.headers || []).filter((h) => h && !h.disabled && h.name).map((h) => [h.name, vars(h.value)]);
    if (r.authentication && r.authentication.type === 'bearer' && r.authentication.token) headers.push(['Authorization', `${r.authentication.prefix || 'Bearer'} ${vars(r.authentication.token)}`]);
    out.requests.push({ id: rid(), name: String(r.name || r.url || 'Request').slice(0, 120), folder: folderOf(r.parentId), method: method(r.method), url: vars(r.url), headers, body, bodyType, ...(form ? { form } : {}) });
  }
  if (out.envs.length) out.env = out.envs[0].id;
  return out;
}

/** Our collection → Postman collection v2.1 (folders as folders, environments are left out – variables of the collection go along; secret values stay empty). */
function toPostman(col) {
  const root = [];
  const folder = (path) => {
    let list = root;
    for (const name of String(path || '').split('/').filter(Boolean)) {
      let f = list.find((x) => x.name === name && Array.isArray(x.item));
      if (!f) { f = { name, item: [] }; list.push(f); }
      list = f.item;
    }
    return list;
  };
  for (const r of col.requests || []) {
    const body = r.bodyType === 'form' ? { mode: 'urlencoded', urlencoded: String(r.body || '').split('&').filter(Boolean).map((p) => { const [k, ...v] = p.split('='); return { key: decodeURIComponent(k), value: decodeURIComponent(v.join('=')) }; }) }
      : r.bodyType === 'multipart' ? { mode: 'formdata', formdata: (r.form || []).map(([k, v, t]) => (t === 'file' ? { key: k, type: 'file', src: v } : { key: k, type: 'text', value: v })) }
        : r.body ? { mode: 'raw', raw: r.body, options: { raw: { language: r.bodyType === 'json' ? 'json' : 'text' } } } : undefined;
    folder(r.folder).push({ name: r.name, request: { method: r.method, header: (r.headers || []).map(([key, value]) => ({ key, value })), url: { raw: r.url }, ...(body ? { body } : {}) } });
  }
  return {
    info: { name: col.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', _postman_id: col.id },
    item: root,
    variable: (col.vars || []).map(([key, value, secret]) => ({ key, value: secret ? '' : value })),
  };
}

/** Which tool made this? → our collection. yamlParse for OpenAPI/Insomnia YAML. */
function detect(text, yamlParse) {
  let j = null;
  const t = String(text || '').trim();
  try { j = JSON.parse(t); } catch { if (yamlParse) { try { j = yamlParse(t); } catch { j = null; } } }
  if (j && typeof j === 'object') {
    if (j.info && Array.isArray(j.item)) return { kind: 'postman', collection: fromPostman(j) };
    if (Array.isArray(j.resources) && j.resources.some((x) => x && x._type)) return { kind: 'insomnia', collection: fromInsomnia(j) };
    if (j.collection && j.collection.info && Array.isArray(j.collection.item)) return { kind: 'postman', collection: fromPostman(j.collection) }; // Postman API export
  }
  return { kind: 'openapi', collection: O.fromOpenApi(O.parseDoc(t, yamlParse)) };
}

module.exports = { fromPostman, fromInsomnia, toPostman, detect };
