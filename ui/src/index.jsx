import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Plus, Trash2, Copy, ClipboardPaste, FolderPlus, Save, History, Variable, Globe, X, Zap, FileJson, Lock, Unlock, Square, ListChecks, Settings2, Play, CalendarClock, Download, Gauge, ShieldCheck, Folder, FolderOpen, RotateCw, CloudOff, Paperclip, Cookie, Layers } from 'lucide-react';
import { get, post, put, del, useApi, waitJob, pickPath, canPickPath } from '@hostwerk/api';
import { Btn, Tabs, Seg, Switch, SettingRow, Empty, Loading, Callout, InfoTip, toast, promptDialog, confirmDialog } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';
import { useFill } from './fill';
import './style.css';

/*
 * API tester: collections (with folders) on the left, the request in the middle, the answer below.
 * Environments (local / staging / live) per collection, secret variables (sealed on the server, masked here), checks per
 * request and a collection run (also as a Hostwerk task), Postman/Insomnia/OpenAPI import, Postman export, forms with
 * files, cookies per collection, cancel, redirects and time limit per request, profiler and page check with one click.
 * Texts are English; German comes from locales/de.json (also inside JSX).
 */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MASK = '••••••';
const uid = () => Math.random().toString(36).slice(2, 10);
const blank = (folder = '') => ({ id: uid(), name: 'New request', folder, method: 'GET', url: '{{base}}/', headers: [], body: '', bodyType: 'json', form: [], options: { follow: false, timeout: 0 }, checks: [] });
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
// 2xx ok, 3xx accent, everything else (no status, 4xx, 5xx) err
const statusKind = (s) => ({ 2: 'ok', 3: 'accent' })[Math.floor((s || 0) / 100)] || 'err';
const CHECK_KINDS = [{ id: 'status', label: 'Status' }, { id: 'json', label: 'JSON field' }, { id: 'header', label: 'Header' }, { id: 'body', label: 'Body text' }, { id: 'time', label: 'Time (ms)' }];
const CHECK_OPS = [{ id: 'eq', label: 'is' }, { id: 'ne', label: 'is not' }, { id: 'contains', label: 'contains' }, { id: 'exists', label: 'exists' }, { id: 'lt', label: 'less than' }, { id: 'gt', label: 'greater than' }];

/** Key/value rows (headers, variables) – empty last row to add more. With `secret`: lock per row (variables). */
function Pairs({ rows, onChange, keyLabel = 'Name', valueLabel = 'Value', secret = false }) {
  const list = [...rows, ['', '', false]];
  const set = (i, j, v) => { const next = list.map((r) => [...r]); next[i][j] = v; onChange(next.filter(([k, val]) => k || val)); };
  return (
    <div className="apit-pairs">
      {list.map(([k, v, s], i) => (
        <div key={i} className={`apit-pair ${secret ? 'with-lock' : ''}`}>
          <input className="input sm mono" value={k} placeholder={keyLabel} aria-label={keyLabel} onChange={(e) => set(i, 0, e.target.value)} />
          <input className="input sm mono" type={secret && s && v !== MASK ? 'password' : 'text'} value={v} placeholder={valueLabel} aria-label={valueLabel} autoComplete="off" onFocus={(e) => { if (v === MASK) e.target.select(); }} onChange={(e) => set(i, 1, e.target.value)} />
          {secret && <button type="button" className={`btn ghost xs icon ${s ? 'apit-locked' : ''}`} aria-pressed={!!s} title={s ? 'Secret – stored sealed, shown masked' : 'Mark as secret'} aria-label={s ? 'Secret – stored sealed, shown masked' : 'Mark as secret'} onClick={() => set(i, 2, !s)}>{s ? <Lock size={13} /> : <Unlock size={13} />}</button>}
          {i < rows.length ? <button type="button" className="btn ghost xs icon" title="Remove" aria-label="Remove" onClick={() => onChange(rows.filter((_, x) => x !== i))}><X size={13} /></button> : <span className="apit-pair-gap" />}
        </div>
      ))}
    </div>
  );
}

/** Form fields with files (multipart/form-data). */
function FormRows({ rows, onChange }) {
  const list = [...rows, ['', '', 'text']];
  const set = (i, j, v) => { const next = list.map((r) => [...r]); next[i][j] = v; onChange(next.filter(([k, val]) => k || val)); };
  const choose = async (i) => { try { const p = await pickPath({ mode: 'file', title: t('Choose file') }); if (p) set(i, 1, p); } catch (e) { toast.error(e); } };
  return (
    <div className="apit-pairs">
      {list.map(([k, v, type], i) => (
        <div key={i} className="apit-pair with-lock">
          <input className="input sm mono" value={k} placeholder="Field" aria-label="Field" onChange={(e) => set(i, 0, e.target.value)} />
          {type === 'file'
            ? <button type="button" className="btn sm ghost apit-file" title={v || undefined} disabled={!canPickPath()} onClick={() => choose(i)}><Paperclip size={13} /><span className="ellipsis">{v ? v.split(/[\\/]/).pop() : t('Choose file')}</span></button>
            : <input className="input sm mono" value={v} placeholder="Value" aria-label="Value" onChange={(e) => set(i, 1, e.target.value)} />}
          <button type="button" className="btn ghost xs icon" aria-pressed={type === 'file'} title={type === 'file' ? 'File – switch to text' : 'Text – switch to file'} aria-label={type === 'file' ? 'File – switch to text' : 'Text – switch to file'} onClick={() => { const next = list.map((r) => [...r]); next[i][2] = type === 'file' ? 'text' : 'file'; next[i][1] = ''; onChange(next.filter(([kk, val, tt], x) => kk || val || (x === i && tt === 'file'))); }}><Paperclip size={13} /></button>
          {i < rows.length ? <button type="button" className="btn ghost xs icon" title="Remove" aria-label="Remove" onClick={() => onChange(rows.filter((_, x) => x !== i))}><X size={13} /></button> : <span className="apit-pair-gap" />}
        </div>
      ))}
    </div>
  );
}

/** Checks of a request: status, JSON field, header, body text, time. */
function Checks({ list, onChange }) {
  const set = (i, patch) => onChange(list.map((c, x) => (x === i ? { ...c, ...patch } : c)));
  return (
    <div className="stack apit-checks">
      {list.length === 0 && <div className="small muted">No checks yet – for example “Status is 200” or “JSON field data.id exists”.</div>}
      {list.map((c, i) => (
        <div key={i} className="apit-check">
          <select className="select sm" aria-label="What" value={c.kind} onChange={(e) => set(i, { kind: e.target.value })}>{CHECK_KINDS.map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}</select>
          {(c.kind === 'json' || c.kind === 'header') ? <input className="input sm mono" aria-label="Field" placeholder={c.kind === 'json' ? 'data.items[0].id' : 'content-type'} value={c.path} onChange={(e) => set(i, { path: e.target.value })} /> : <span />}
          <select className="select sm" aria-label="Condition" value={c.op} onChange={(e) => set(i, { op: e.target.value })}>{CHECK_OPS.map((o) => <option key={o.id} value={o.id}>{t(o.label)}</option>)}</select>
          {c.op !== 'exists' ? <input className="input sm mono" aria-label="Expected" placeholder={c.kind === 'status' ? '200' : ''} value={c.value} onChange={(e) => set(i, { value: e.target.value })} /> : <span />}
          <button type="button" className="btn ghost xs icon" title="Remove" aria-label="Remove" onClick={() => onChange(list.filter((_, x) => x !== i))}><X size={13} /></button>
        </div>
      ))}
      <div><Btn className="sm ghost" icon={Plus} onClick={() => onChange([...list, { kind: 'status', path: '', op: 'eq', value: '200' }])}>Add check</Btn></div>
    </div>
  );
}

function CheckResults({ checks }) {
  if (!checks || !checks.length) return null;
  const failed = checks.filter((c) => !c.ok).length;
  return (
    <div className="apit-results">
      <div className="small"><span className={`badge ${failed ? 'err' : 'ok'}`}>{failed ? t('{n} of {total} checks failed', { n: failed, total: checks.length }) : t('All {n} checks passed', { n: checks.length })}</span></div>
      {checks.map((c, i) => <div key={i} className="row-tight small"><span className={c.ok ? 'c-ok' : 'c-err'} aria-hidden="true">{c.ok ? '✓' : '✗'}</span><span className="grow mono">{t(CHECK_KINDS.find((k) => k.id === c.kind).label)}{c.path ? ` ${c.path}` : ''} {t(CHECK_OPS.find((o) => o.id === c.op).label)} {c.op === 'exists' ? '' : c.value}</span>{!c.ok && <span className="muted tiny">{t('got {value}', { value: c.actual === undefined ? '–' : c.actual })}</span>}</div>)}
    </div>
  );
}

function Answer({ r }) {
  const [tab, setTab] = useState('body');
  const pretty = useMemo(() => {
    if (!r || r.base64 || typeof r.body !== 'string') return null;
    if (/json/i.test(r.contentType || '') || /^\s*[[{]/.test(r.body)) { try { return JSON.stringify(JSON.parse(r.body), null, 2); } catch { /* as text */ } }
    return r.body;
  }, [r]);
  if (!r) return <Empty icon={Send} title="No answer yet" text="Send a request – the answer appears here with status, time and size." />;
  if (r.error) return <Callout kind={r.cancelled ? 'warn' : 'err'}>{r.error}</Callout>;
  return (
    <div className="apit-answer">
      <div className="row-tight apit-answer-head">
        <span className={`badge ${statusKind(r.status)}`}>{r.status} {r.statusText}</span>
        <span className="small muted">{r.ms} ms · {fmtSize(r.size)}{r.cut ? ` · ${t('cut at 2 MB')}` : ''}{r.redirected ? ` · ${t('followed redirects')}` : ''}</span>
        <span className="grow" />
        <Tabs tabs={[{ id: 'body', label: 'Body' }, { id: 'headers', label: t('Headers ({n})', { n: Object.keys(r.headers || {}).length }) }]} value={tab} onChange={setTab} />
      </div>
      <CheckResults checks={r.checks} />
      {tab === 'body' ? (r.base64 ? <div className="small muted">{t('Binary answer ({type}) – not shown.', { type: r.contentType || t('unknown type') })}</div> : <pre className="code-block apit-pre">{pretty || t('(empty)')}</pre>)
        : <table className="table"><tbody>{Object.entries(r.headers || {}).map(([k, v]) => <tr key={k}><td className="mono small">{k}</td><td className="mono small">{v}</td></tr>)}</tbody></table>}
    </div>
  );
}

/** Result of a collection run. */
function RunResult({ run, onClose }) {
  return (
    <div className="card">
      <div className="card-head"><ListChecks size={16} /><h3>{t('Run of “{name}”', { name: run.name })}</h3><span className={`badge ${run.failed ? 'err' : 'ok'}`}>{run.failed ? t('{n} failed', { n: run.failed }) : t('all passed')}</span>
        <div className="right"><button type="button" className="btn ghost xs icon" title="Close" aria-label="Close" onClick={onClose}><X /></button></div></div>
      <div className="card-body stack apit-run">
        {run.results.map((x) => (
          <div key={x.id} className="row-tight small">
            <span className={x.ok ? 'c-ok' : 'c-err'} aria-hidden="true">{x.ok ? '✓' : '✗'}</span>
            <span className={`apit-m apit-m-${x.method.toLowerCase()}`}>{x.method}</span>
            <span className="grow ellipsis">{x.folder ? <span className="muted">{x.folder} / </span> : null}{x.name}</span>
            <span className="muted tiny">{x.error || `${x.status} · ${x.ms} ms`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Requests of a collection grouped by folder (collapsible). */
function Tree({ col, sel, onPick, onAdd }) {
  const [closed, setClosed] = useState({});
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of col.requests) { const k = r.folder || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [col.requests]);
  const item = (r) => (
    <button type="button" key={r.id} className={`list-item apit-req ${r.id === sel ? 'is-active' : ''}`} aria-current={r.id === sel ? 'true' : undefined} onClick={() => onPick(r.id)}>
      <span className={`apit-m apit-m-${r.method.toLowerCase()}`}>{r.method}</span><span className="ellipsis small">{r.name}</span>
    </button>
  );
  return (
    <>
      {groups.map(([folder, list]) => (folder === '' ? list.map(item) : (
        <div key={folder} className="apit-folder">
          <button type="button" className="apit-folder-name" aria-expanded={!closed[folder]} onClick={() => setClosed({ ...closed, [folder]: !closed[folder] })}>{closed[folder] ? <Folder size={13} /> : <FolderOpen size={13} />}<span className="ellipsis">{folder}</span><span className="tiny muted">{list.length}</span></button>
          {!closed[folder] && <div className="apit-folder-items">{list.map(item)}</div>}
        </div>
      )))}
      <button type="button" className="link-btn" onClick={onAdd}><Plus size={13} /> New request</button>
    </>
  );
}

function ApiTesterPage({ query = '' } = {}) {
  // Wie ein echtes API-Werkzeug: Sammlungen links, rechts oben die Anfrage, unten die Antwort – alles in der Fensterhöhe,
  // nur die Flächen scrollen
  const fill = useFill({ min: 420 });
  const st = useApi('/api-tester', [], { live: false });
  const targets = useApi('/api-tester/targets', [], { live: false });
  const [cols, setCols] = useState(null);
  const [sel, setSel] = useState({ col: null, req: null });
  const [tab, setTab] = useState('headers');
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(null); // rid of the running request
  const [run, setRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveT = useRef(null);
  // Direkt öffnen (z. B. aus dem Webhook-Postfach: #/ext/api-tester?col=…&req=…), sonst die erste Sammlung
  useEffect(() => {
    if (!st.data || cols) return;
    setCols(st.data.collections);
    const q = new URLSearchParams(query);
    const want = st.data.collections.find((x) => x.id === q.get('col'));
    const c = want || st.data.collections[0];
    if (c) setSel({ col: c.id, req: want && c.requests.some((r) => r.id === q.get('req')) ? q.get('req') : (c.requests[0] || {}).id || null });
  }, [st.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const col = (cols || []).find((c) => c.id === sel.col) || null;
  const req = col ? col.requests.find((r) => r.id === sel.req) || null : null;
  const tg = targets.data && !Array.isArray(targets.data) ? targets.data : { list: Array.isArray(targets.data) ? targets.data : [], profiler: false, pageCheck: false };

  // Every change is saved shortly after typing stops (secret values come back masked)
  const update = (next) => {
    setCols(next); setDirty(true); clearTimeout(saveT.current);
    saveT.current = setTimeout(() => put('/api-tester/collections', { collections: next }).then((saved) => { setDirty(false); setCols((cur) => (cur === next ? saved : cur)); }).catch((e) => toast.error(e)), 600);
  };
  const patchReq = (patch) => update(cols.map((c) => (c.id !== col.id ? c : { ...c, requests: c.requests.map((r) => (r.id === req.id ? { ...r, ...patch } : r)) })));
  const patchCol = (patch) => update(cols.map((c) => (c.id === col.id ? { ...c, ...patch } : c)));
  const addReq = (r = blank(req ? req.folder : ''), into = col) => { if (!into) return; update((cols || []).map((c) => (c.id === into.id ? { ...c, requests: [...c.requests, r] } : c))); setSel({ col: into.id, req: r.id }); setAnswer(null); };
  const addCol = async (c0) => {
    let c = c0;
    if (!c) {
      const name = await promptDialog({ title: 'New collection', label: 'Name', placeholder: 'e.g. Shop API' });
      if (!name) return null;
      c = { id: uid(), name, vars: [['base', 'http://localhost', false]], envs: [], env: null, requests: [blank()] };
    }
    update([...(cols || []), c]); setSel({ col: c.id, req: (c.requests[0] || {}).id || null });
    return c;
  };
  const removeReq = async (r) => {
    if (!(await confirmDialog({ title: t('Remove “{name}”?', { name: r.name }), confirm: 'Remove', danger: true }))) return;
    update(cols.map((c) => (c.id === col.id ? { ...c, requests: c.requests.filter((x) => x.id !== r.id) } : c)));
    if (sel.req === r.id) setSel({ col: col.id, req: null });
  };
  const removeCol = async () => {
    if (!(await confirmDialog({ title: t('Remove the collection “{name}”?', { name: col.name }), text: 'All requests in it are deleted.', confirm: 'Remove', danger: true }))) return;
    const next = cols.filter((c) => c.id !== col.id); update(next); setSel({ col: (next[0] || {}).id || null, req: null });
  };
  const sendNow = async () => {
    if (!req || busy) return;
    const rid = uid();
    setBusy(rid); setAnswer(null);
    try { setAnswer(await post('/api-tester/send', { col: col.id, request: req, rid })); st.reload({ silent: true }); } catch (e) { toast.error(e); }
    setBusy(null);
  };
  const cancel = () => { if (busy) post('/api-tester/cancel', { rid: busy }).catch(() => {}); };
  const pasteCurl = async () => {
    const command = await promptDialog({ title: 'Paste a curl command', label: 'curl …', placeholder: "curl -X POST https://… -H 'Content-Type: application/json' -d '{…}'", multiline: true });
    if (!command) return;
    try { const r = await post('/api-tester/curl', { command }); addReq({ ...blank(), name: `${r.method} ${r.url.replace(/^https?:\/\//, '').slice(0, 40)}`, ...r }); toast.success('Request added'); } catch (e) { toast.error(e); }
  };
  // Postman, Insomnia, OpenAPI/Swagger: Adresse oder eingefügter Text → neue Sammlung
  const importAny = async () => {
    const input = await promptDialog({ title: 'Import a collection', label: 'Postman or Insomnia export, OpenAPI/Swagger description (JSON or YAML) – or its address', placeholder: 'https://…/openapi.json', multiline: true });
    if (!input) return;
    const v = input.trim();
    try {
      const r = await post('/api-tester/import', /^https?:\/\/\S+$/i.test(v) ? { url: v } : { text: v });
      await addCol(r.collection);
      toast.success(t('{n} requests imported ({kind})', { n: r.collection.requests.length, kind: { postman: 'Postman', insomnia: 'Insomnia', openapi: 'OpenAPI' }[r.kind] || r.kind }));
    } catch (e) { toast.error(e); }
  };
  const exportCol = async () => {
    try {
      const j = await get(`/api-tester/export/${encodeURIComponent(col.id)}`);
      const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${col.name.replace(/[^\w-]+/g, '_')}.postman_collection.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast.success('Exported for Postman – secret values stay empty');
    } catch (e) { toast.error(e); }
  };
  const runCol = async () => { setRunning(true); setRun(null); try { setRun(await post('/api-tester/run', { col: col.id })); } catch (e) { toast.error(e); } setRunning(false); };
  const schedule = async () => {
    const time = await promptDialog({ title: 'Run every day as a task', text: 'Hostwerk runs all requests of this collection with their checks and tells you when one fails.', label: 'Time', value: '06:00', placeholder: '06:00', validate: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v).trim()) ? null : t('Time as HH:MM, e.g. 06:00')) });
    if (!time) return;
    try { const r = await post('/api-tester/schedule', { col: col.id, time: String(time).trim() }); toast.success(t('Task “{name}” created', { name: r.name })); } catch (e) { toast.error(e); }
  };
  const copyCurl = async () => {
    try { const { command } = await post('/api-tester/to-curl', { col: col.id, request: req }); await navigator.clipboard.writeText(command); toast.success('curl command copied'); } catch (e) { toast.error(e); }
  };
  const profile = async () => { try { const r = await post('/api-tester/profile', { col: col.id, request: req }); toast('Measuring – the result appears in the profiler.'); await waitJob(r.job); location.hash = '/ext/profiler'; } catch (e) { toast.error(e); } };
  const pageCheck = async () => { try { const r = await post('/api-tester/page-check', { col: col.id, request: req }); toast.success(t('Page check: {score} points', { score: r.score != null ? r.score : '?' })); } catch (e) { toast.error(e); } };
  const rename = async () => { const n = await promptDialog({ title: 'Rename request', label: 'Name', value: req.name }); if (n) patchReq({ name: n }); };
  const move = async () => { const f = await promptDialog({ title: 'Move to folder', label: 'Folder (empty = no folder, “a/b” = folder in a folder)', value: req.folder || '' }); if (f !== null && f !== undefined) patchReq({ folder: String(f).split('/').map((x) => x.trim()).filter(Boolean).join('/') }); };
  const clearHistory = async () => { try { await del('/api-tester/history'); st.reload({ silent: true }); } catch (e) { toast.error(e); } };
  // Verlauf ohne Sammlung: die Anfrage landet in einer neuen Sammlung „Aus dem Verlauf“ (statt still nichts zu tun)
  const fromHistory = async (h) => {
    const r = { ...blank(), ...h.request, id: uid(), name: h.request.name || `${h.method} ${String(h.url).slice(0, 40)}` };
    if (col) { addReq(r); return; }
    await addCol({ id: uid(), name: t('From the history'), vars: [], envs: [], env: null, requests: [r] });
  };
  // Umgebungen
  const env = col && (col.envs || []).find((e) => e.id === col.env);
  const addEnv = async () => { const name = await promptDialog({ title: 'New environment', label: 'Name', placeholder: 'e.g. Staging' }); if (!name) return; const e = { id: uid(), name, vars: (col.vars || []).filter(([k]) => k === 'base').map(([k, v, s]) => [k, v, s]) }; patchCol({ envs: [...(col.envs || []), e], env: e.id }); };
  const removeEnv = async () => { if (!env || !(await confirmDialog({ title: t('Remove the environment “{name}”?', { name: env.name }), confirm: 'Remove', danger: true }))) return; const rest = col.envs.filter((e) => e.id !== env.id); patchCol({ envs: rest, env: (rest[0] || {}).id || null }); };
  const setEnvVars = (vars) => patchCol({ envs: col.envs.map((e) => (e.id === env.id ? { ...e, vars } : e)) });
  const clearCookies = async () => { try { const r = await del(`/api-tester/cookies/${encodeURIComponent(col.id)}`); setCols(r.collections); toast.success('Cookies cleared'); } catch (e) { toast.error(e); } };

  if (!st.data && st.error) return <div className="page"><Empty icon={CloudOff} title="Could not load the API tester" text={st.error} action={<Btn icon={RotateCw} onClick={() => st.reload()}>Try again</Btn>} /></div>;
  if (st.loading && !cols) return <div className="page"><Loading /></div>;
  const hist = (st.data && st.data.history) || [];
  const bodyTypes = [{ id: 'json', label: 'JSON' }, { id: 'form', label: 'Form' }, { id: 'multipart', label: 'Form with files' }, { id: 'text', label: 'Text' }];
  return (
    <div className="page fade-in apit">
      <div className="page-head">
        <div>
          <h1><Zap /> API tester</h1>
          <p>Send requests to your projects, save them in collections and reuse them.</p>
        </div>
        <div className="actions">
          {dirty && <span className="small muted">Saving …</span>}
          <Btn className="sm" icon={ClipboardPaste} onClick={pasteCurl}>Paste curl</Btn>
          <Btn className="sm" icon={FileJson} onClick={importAny}>Import</Btn>
          <Btn className="sm" icon={FolderPlus} onClick={() => addCol()}>New collection</Btn>
        </div>
      </div>
      <div className="apit-grid" ref={fill}>
        <aside className="card apit-side" aria-label="Collections">
          {(cols || []).map((c) => (
            <div key={c.id} className="apit-col">
              <button type="button" className={`apit-col-name ${c.id === sel.col ? 'is-active' : ''}`} onClick={() => setSel({ col: c.id, req: (c.requests[0] || {}).id || null })}>{c.name}</button>
              {c.id === sel.col && <Tree col={c} sel={sel.req} onPick={(id) => { setSel({ col: c.id, req: id }); setAnswer(null); }} onAdd={() => addReq()} />}
            </div>
          ))}
          {hist.length > 0 && (
            <div className="apit-hist">
              <div className="row-tight"><History size={13} /><b className="small grow">History</b><button type="button" className="link-btn" onClick={clearHistory}>Clear</button></div>
              {hist.slice(0, 12).map((h, i) => (
                <button type="button" key={i} className="list-item apit-req" title={h.url} onClick={() => fromHistory(h)}>
                  <span className={`apit-m apit-m-${String(h.method || 'get').toLowerCase()}`}>{h.method}</span><span className="ellipsis small grow">{String(h.url).replace(/^https?:\/\//, '')}</span><span className={`tiny ${h.error || h.status >= 400 ? 'c-err' : 'muted'}`}>{h.error ? '!' : h.status}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
        <main className="stack apit-main">
          {col && (
            <div className="row-tight apit-colbar">
              <Layers size={14} className="muted" />
              <b className="small">{col.name}</b>
              {(col.envs || []).length > 0 && (
                <select className="select sm apit-env" aria-label="Environment" value={col.env || ''} onChange={(e) => patchCol({ env: e.target.value || null })}>
                  {col.envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              <InfoTip title="Environments">Switch between local, staging and live in one go: the values of the chosen environment replace the variables of the collection – {'{{base}}'} points to the right server.</InfoTip>
              <span className="grow" />
              <Btn className="sm ghost" icon={Play} busy={running} disabled={!col.requests.length} onClick={runCol}>Run collection</Btn>
              <Btn className="sm ghost" icon={CalendarClock} onClick={schedule}>As a task</Btn>
              <Btn className="sm ghost" icon={Download} onClick={exportCol}>Export</Btn>
            </div>
          )}
          {run && <RunResult run={run} onClose={() => setRun(null)} />}
          {!col ? <Empty icon={FolderPlus} title="No collection yet" text="Create a collection to keep your requests together."><Btn className="primary" icon={FolderPlus} onClick={() => addCol()}>New collection</Btn></Empty> : !req ? (
            <Empty icon={Send} title="Pick or create a request" text="Requests live in the collection on the left."><Btn className="primary" icon={Plus} onClick={() => addReq()}>New request</Btn></Empty>
          ) : (
            <>
              <div className="card apit-req-card">
                <div className="card-head">
                  <button type="button" className="link-btn bold" title="Rename" onClick={rename}>{req.name}</button>
                  <button type="button" className="btn ghost xs" title="Move to folder" onClick={move}><Folder size={13} />{req.folder || t('no folder')}</button>
                  <div className="right row-tight apit-wrap">
                    {tg.profiler && <Btn className="sm ghost" icon={Gauge} onClick={profile}>Measure this request</Btn>}
                    {tg.pageCheck && req.method === 'GET' && <Btn className="sm ghost" icon={ShieldCheck} onClick={pageCheck}>Check page</Btn>}
                    <Btn className="sm ghost" icon={Copy} onClick={copyCurl}>Copy as curl</Btn>
                    <Btn className="sm ghost" icon={Trash2} title="Remove request" aria-label="Remove request" onClick={() => removeReq(req)} />
                  </div>
                </div>
                <div className="card-body stack apit-body">
                  <form className="apit-line" onSubmit={(e) => { e.preventDefault(); sendNow(); }}>
                    <select className="select apit-method" value={req.method} aria-label="Method" onChange={(e) => patchReq({ method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
                    <input className="input mono grow" value={req.url} aria-label="Address" placeholder="{{base}}/api/users" onChange={(e) => patchReq({ url: e.target.value })} />
                    {busy ? <Btn className="danger" icon={Square} onClick={cancel}>Cancel</Btn> : <Btn className="primary" icon={Send} type="submit">Send</Btn>}
                  </form>
                  {tg.list.length > 0 && (
                    <div className="row-tight apit-wrap">
                      <Globe size={13} className="muted" /><span className="tiny muted">{env ? t('Use as {{base}} in “{name}”:', { name: env.name }) : t('Use as {{base}}:')}</span>
                      {tg.list.slice(0, 8).map((x) => <button type="button" key={x.url} className="chip-btn" title={x.url} onClick={() => (env ? setEnvVars([['base', x.url, false], ...env.vars.filter(([k]) => k !== 'base')]) : patchCol({ vars: [['base', x.url, false], ...col.vars.filter(([k]) => k !== 'base')] }))}>{x.label}</button>)}
                    </div>
                  )}
                  <Tabs tabs={[{ id: 'headers', label: t('Headers ({n})', { n: req.headers.length }) }, { id: 'body', label: 'Body', disabled: ['GET', 'HEAD'].includes(req.method) }, { id: 'checks', label: t('Checks ({n})', { n: (req.checks || []).length }), icon: ListChecks }, { id: 'vars', label: t('Variables ({n})', { n: col.vars.length }), icon: Variable }, { id: 'options', label: 'Settings', icon: Settings2 }]} value={tab} onChange={setTab} />
                  {tab === 'headers' && <Pairs rows={req.headers} onChange={(headers) => patchReq({ headers })} keyLabel="Header" />}
                  {tab === 'body' && (
                    <div className="stack apit-body-tab">
                      <Seg options={bodyTypes} value={req.bodyType} onChange={(bodyType) => patchReq({ bodyType })} />
                      {req.bodyType === 'multipart' ? <FormRows rows={req.form || []} onChange={(form) => patchReq({ form })} />
                        : <textarea className="input mono" rows={8} value={req.body} aria-label="Body" placeholder={req.bodyType === 'json' ? '{ "name": "{{user}}" }' : req.bodyType === 'form' ? 'name=Alex&age=30' : ''} onChange={(e) => patchReq({ body: e.target.value })} />}
                    </div>
                  )}
                  {tab === 'checks' && <Checks list={req.checks || []} onChange={(checks) => patchReq({ checks })} />}
                  {tab === 'vars' && (
                    <div className="stack apit-body-tab">
                      <div className="row-tight"><span className="small muted grow">{'Write {{name}} in the address, headers or body – the value comes from here.'}</span><InfoTip pop title="Variables">They belong to the collection, so every request in it uses the same values. Secret values (lock) are stored sealed on this PC and only shown masked – the history never keeps them.</InfoTip></div>
                      <Pairs rows={col.vars} onChange={(vars) => patchCol({ vars })} keyLabel="Variable" secret />
                      <div className="row-tight apit-wrap">
                        <b className="small">Environment</b>
                        {(col.envs || []).length > 0 && <Seg options={col.envs.map((e) => ({ id: e.id, label: e.name }))} value={col.env} onChange={(id) => patchCol({ env: id })} />}
                        <Btn className="sm ghost" icon={Plus} onClick={addEnv}>New environment</Btn>
                        {env && <Btn className="sm ghost danger" icon={Trash2} onClick={removeEnv}>Remove environment</Btn>}
                      </div>
                      {env && <><div className="small muted">{t('Values in “{name}” replace those of the collection.', { name: env.name })}</div><Pairs rows={env.vars} onChange={setEnvVars} keyLabel="Variable" secret /></>}
                      <div className="row-tight"><Btn className="sm ghost danger" icon={Trash2} onClick={removeCol}>Remove collection</Btn></div>
                    </div>
                  )}
                  {tab === 'options' && (
                    <div className="stack apit-body-tab">
                      <SettingRow title="Follow redirects" text="Off = the answer shows the redirect itself (3xx with Location)."><Switch checked={!!(req.options && req.options.follow)} onChange={(v) => patchReq({ options: { ...(req.options || {}), follow: v } })} /></SettingRow>
                      <SettingRow title="Time limit (seconds)" text="0 = 30 seconds. At most 600.">
                        <input className="input sm apit-num" type="number" min="0" max="600" aria-label="Time limit (seconds)" value={(req.options && req.options.timeout) || 0} onChange={(e) => patchReq({ options: { ...(req.options || {}), timeout: Math.max(0, Math.min(600, Number(e.target.value) || 0)) } })} />
                      </SettingRow>
                      <SettingRow title={<><Cookie size={14} /> Remember cookies</>} text={col.cookieJar ? t('For the whole collection – {n} stored.', { n: col.cookieCount || 0 }) : 'For the whole collection: cookies from answers are sent with the next requests (log-ins, sessions).'}>
                        <div className="row-tight">{col.cookieJar && col.cookieCount > 0 && <Btn className="xs ghost" onClick={clearCookies}>Clear</Btn>}<Switch checked={!!col.cookieJar} onChange={(v) => patchCol({ cookieJar: v })} /></div>
                      </SettingRow>
                    </div>
                  )}
                </div>
              </div>
              <div className="card apit-answer-card"><div className="card-head"><Save size={16} /><h3>Answer</h3></div><div className="card-body apit-answer-body">{busy ? <Loading /> : <Answer r={answer} />}</div></div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default {
  pages: { main: ApiTesterPage },
  slots: {
    // Seit Hostwerk 3.0 (SDK 3.2) ohne eigenen Seitenleisten-Eintrag ("nav": false) – die ganze Seite als Reiter im passenden Bereich;
    // Hostwerk blendet dabei ihren Titel aus (Reiter + Herkunftszeile sagen schon, was es ist), die Knöpfe bleiben
    'projects.tabs': [{ id: 'api', title: 'API tester', icon: Send, Component: ApiTesterPage, order: 40 }],
  },
};
