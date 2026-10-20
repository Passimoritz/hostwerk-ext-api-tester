import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Plus, Trash2, Copy, ClipboardPaste, FolderPlus, Save, History, Variable, Globe, X, Zap, FileJson } from 'lucide-react';
import { post, put, del, useApi } from '@hostwerk/api';
import { Btn, Tabs, Seg, Empty, Loading, Callout, InfoTip, toast, promptDialog, confirmDialog } from '@hostwerk/ui';
import './style.css';

/*
 * API tester: collections on the left, the request in the middle, the answer below.
 * Texts are English; German comes from locales/de.json (also inside JSX).
 */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const uid = () => Math.random().toString(36).slice(2, 10);
const blank = () => ({ id: uid(), name: 'New request', method: 'GET', url: '{{base}}/', headers: [], body: '', bodyType: 'json' });
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
// 2xx ok, 3xx accent, everything else (no status, 4xx, 5xx) err
const statusKind = (s) => ({ 2: 'ok', 3: 'accent' })[Math.floor((s || 0) / 100)] || 'err';

/** Key/value rows (headers, variables) – empty last row to add more. */
function Pairs({ rows, onChange, keyLabel = 'Name', valueLabel = 'Value' }) {
  const list = [...rows, ['', '']];
  const set = (i, j, v) => { const next = list.map((r) => [...r]); next[i][j] = v; onChange(next.filter(([k, val]) => k || val)); };
  return (
    <div className="apit-pairs">
      {list.map(([k, v], i) => (
        <div key={i} className="apit-pair">
          <input className="input sm mono" value={k} placeholder={keyLabel} aria-label={keyLabel} onChange={(e) => set(i, 0, e.target.value)} />
          <input className="input sm mono" value={v} placeholder={valueLabel} aria-label={valueLabel} onChange={(e) => set(i, 1, e.target.value)} />
          {i < rows.length ? <button type="button" className="btn ghost xs icon" title="Remove" aria-label="Remove" onClick={() => onChange(rows.filter((_, x) => x !== i))}><X size={13} /></button> : <span className="apit-pair-gap" />}
        </div>
      ))}
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
  if (r.error) return <Callout kind="err">{r.error}</Callout>;
  return (
    <div className="apit-answer">
      <div className="row-tight apit-answer-head">
        <span className={`badge ${statusKind(r.status)}`}>{r.status} {r.statusText}</span>
        <span className="small muted">{r.ms} ms · {fmtSize(r.size)}{r.cut ? ' · cut at 2 MB' : ''}</span>
        <span className="grow" />
        <Tabs tabs={[{ id: 'body', label: 'Body' }, { id: 'headers', label: `Headers (${Object.keys(r.headers || {}).length})` }]} value={tab} onChange={setTab} />
      </div>
      {tab === 'body' ? (r.base64 ? <div className="small muted">Binary answer ({r.contentType || 'unknown type'}) – not shown.</div> : <pre className="code-block apit-pre">{pretty || '(empty)'}</pre>)
        : <table className="table"><tbody>{Object.entries(r.headers || {}).map(([k, v]) => <tr key={k}><td className="mono small">{k}</td><td className="mono small">{v}</td></tr>)}</tbody></table>}
    </div>
  );
}

function ApiTesterPage() {
  const st = useApi('/api-tester', [], { live: false });
  const targets = useApi('/api-tester/targets', [], { live: false });
  const [cols, setCols] = useState(null);
  const [sel, setSel] = useState({ col: null, req: null });
  const [tab, setTab] = useState('headers');
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveT = useRef(null);
  useEffect(() => { if (st.data && !cols) { setCols(st.data.collections); const c = st.data.collections[0]; if (c) setSel({ col: c.id, req: (c.requests[0] || {}).id || null }); } }, [st.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const col = (cols || []).find((c) => c.id === sel.col) || null;
  const req = col ? col.requests.find((r) => r.id === sel.req) || null : null;

  // Every change is saved shortly after typing stops
  const update = (next) => { setCols(next); setDirty(true); clearTimeout(saveT.current); saveT.current = setTimeout(() => put('/api-tester/collections', { collections: next }).then(() => setDirty(false)).catch((e) => toast.error(e)), 600); };
  const patchReq = (patch) => update(cols.map((c) => (c.id !== col.id ? c : { ...c, requests: c.requests.map((r) => (r.id === req.id ? { ...r, ...patch } : r)) })));
  const patchCol = (patch) => update(cols.map((c) => (c.id === col.id ? { ...c, ...patch } : c)));
  const addReq = (r = blank()) => { if (!col) return; update(cols.map((c) => (c.id === col.id ? { ...c, requests: [...c.requests, r] } : c))); setSel({ col: col.id, req: r.id }); setAnswer(null); };
  const addCol = async () => {
    const name = await promptDialog({ title: 'New collection', label: 'Name', placeholder: 'e.g. Shop API' });
    if (!name) return;
    const c = { id: uid(), name, vars: [['base', 'http://localhost']], requests: [blank()] };
    update([...(cols || []), c]); setSel({ col: c.id, req: c.requests[0].id });
  };
  const removeReq = async (r) => {
    if (!(await confirmDialog({ title: `Remove “${r.name}”?`, confirm: 'Remove', danger: true }))) return;
    update(cols.map((c) => (c.id === col.id ? { ...c, requests: c.requests.filter((x) => x.id !== r.id) } : c)));
    if (sel.req === r.id) setSel({ col: col.id, req: null });
  };
  const removeCol = async () => {
    if (!(await confirmDialog({ title: `Remove the collection “${col.name}”?`, text: 'All requests in it are deleted.', confirm: 'Remove', danger: true }))) return;
    const next = cols.filter((c) => c.id !== col.id); update(next); setSel({ col: (next[0] || {}).id || null, req: null });
  };
  const sendNow = async () => {
    if (!req) return;
    setBusy(true); setAnswer(null);
    try { setAnswer(await post('/api-tester/send', { request: req, vars: col.vars })); st.reload({ silent: true }); } catch (e) { toast.error(e); }
    setBusy(false);
  };
  const pasteCurl = async () => {
    const command = await promptDialog({ title: 'Paste a curl command', label: 'curl …', placeholder: "curl -X POST https://… -H 'Content-Type: application/json' -d '{…}'", multiline: true });
    if (!command) return;
    try { const r = await post('/api-tester/curl', { command }); addReq({ id: uid(), name: `${r.method} ${r.url.replace(/^https?:\/\//, '').slice(0, 40)}`, ...r }); toast.success('Request added'); } catch (e) { toast.error(e); }
  };
  // OpenAPI/Swagger: Adresse oder eingefügter Text (JSON/YAML) → neue Sammlung mit allen Anfragen
  const importOpenApi = async () => {
    const input = await promptDialog({ title: 'Import OpenAPI', label: 'Address of the description or the description itself (JSON or YAML)', placeholder: 'https://…/openapi.json', multiline: true });
    if (!input) return;
    const v = input.trim();
    try {
      const c = await post('/api-tester/openapi', /^https?:\/\/\S+$/i.test(v) ? { url: v } : { text: v });
      update([...(cols || []), c]);
      setSel({ col: c.id, req: (c.requests[0] || {}).id || null });
      toast.success(`${c.requests.length} requests imported`);
    } catch (e) { toast.error(e); }
  };
  const copyCurl = async () => {
    try { const { command } = await post('/api-tester/to-curl', { request: req, vars: col.vars }); await navigator.clipboard.writeText(command); toast.success('curl command copied'); } catch (e) { toast.error(e); }
  };
  const rename = async () => { const n = await promptDialog({ title: 'Rename request', label: 'Name', value: req.name }); if (n) patchReq({ name: n }); };
  const clearHistory = async () => { await del('/api-tester/history'); st.reload({ silent: true }); };

  if (st.loading && !cols) return <Loading />;
  const hist = (st.data && st.data.history) || [];
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
          <Btn className="sm" icon={FileJson} onClick={importOpenApi}>Import OpenAPI</Btn>
          <Btn className="sm" icon={FolderPlus} onClick={addCol}>New collection</Btn>
        </div>
      </div>
      <div className="apit-grid">
        <aside className="card apit-side" aria-label="Collections">
          {(cols || []).map((c) => (
            <div key={c.id} className="apit-col">
              <button type="button" className={`apit-col-name ${c.id === sel.col ? 'active' : ''}`} onClick={() => setSel({ col: c.id, req: (c.requests[0] || {}).id || null })}>{c.name}</button>
              {c.id === sel.col && c.requests.map((r) => (
                <button type="button" key={r.id} className={`list-item apit-req ${r.id === sel.req ? 'active' : ''}`} aria-current={r.id === sel.req ? 'true' : undefined} onClick={() => { setSel({ col: c.id, req: r.id }); setAnswer(null); }}>
                  <span className={`apit-m apit-m-${r.method.toLowerCase()}`}>{r.method}</span><span className="ellipsis small">{r.name}</span>
                </button>
              ))}
              {c.id === sel.col && <button type="button" className="link-btn" onClick={() => addReq()}><Plus size={13} /> New request</button>}
            </div>
          ))}
          {hist.length > 0 && (
            <div className="apit-hist">
              <div className="row-tight"><History size={13} /><b className="small grow">History</b><button type="button" className="link-btn" onClick={clearHistory}>Clear</button></div>
              {hist.slice(0, 12).map((h, i) => (
                <button type="button" key={i} className="list-item apit-req" title={h.url} onClick={() => col && addReq({ ...blank(), ...h.request, id: uid(), name: h.request.name || `${h.method} ${String(h.url).slice(0, 40)}` })}>
                  <span className={`apit-m apit-m-${String(h.method || 'get').toLowerCase()}`}>{h.method}</span><span className="ellipsis small grow">{String(h.url).replace(/^https?:\/\//, '')}</span><span className={`tiny ${h.error || h.status >= 400 ? 'c-err' : 'muted'}`}>{h.error ? '!' : h.status}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
        <main className="stack apit-main">
          {!col ? <Empty icon={FolderPlus} title="No collection yet" text="Create a collection to keep your requests together."><Btn className="primary" icon={FolderPlus} onClick={addCol}>New collection</Btn></Empty> : !req ? (
            <Empty icon={Send} title="Pick or create a request" text="Requests live in the collection on the left."><Btn className="primary" icon={Plus} onClick={() => addReq()}>New request</Btn></Empty>
          ) : (
            <>
              <div className="card">
                <div className="card-head">
                  <button type="button" className="link-btn bold" title="Rename" onClick={rename}>{req.name}</button>
                  <div className="right row-tight">
                    <Btn className="sm ghost" icon={Copy} onClick={copyCurl}>Copy as curl</Btn>
                    <Btn className="sm ghost" icon={Trash2} title="Remove request" aria-label="Remove request" onClick={() => removeReq(req)} />
                  </div>
                </div>
                <div className="card-body stack" style={{ gap: 12 }}>
                  <form className="apit-line" onSubmit={(e) => { e.preventDefault(); sendNow(); }}>
                    <select className="select apit-method" value={req.method} aria-label="Method" onChange={(e) => patchReq({ method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
                    <input className="input mono grow" value={req.url} aria-label="Address" placeholder="{{base}}/api/users" onChange={(e) => patchReq({ url: e.target.value })} />
                    <Btn className="primary" icon={Send} busy={busy} type="submit">Send</Btn>
                  </form>
                  {(targets.data || []).length > 0 && (
                    <div className="row-tight apit-targets">
                      <Globe size={13} className="muted" /><span className="tiny muted">{'Use as {{base}}:'}</span>
                      {targets.data.slice(0, 8).map((x) => <button type="button" key={x.url} className="chip-btn" title={x.url} onClick={() => patchCol({ vars: [['base', x.url], ...col.vars.filter(([k]) => k !== 'base')] })}>{x.label}</button>)}
                    </div>
                  )}
                  <Tabs tabs={[{ id: 'headers', label: `Headers (${req.headers.length})` }, { id: 'body', label: 'Body', disabled: ['GET', 'HEAD'].includes(req.method) }, { id: 'vars', label: `Variables (${col.vars.length})`, icon: Variable }]} value={tab} onChange={setTab} />
                  {tab === 'headers' && <Pairs rows={req.headers} onChange={(headers) => patchReq({ headers })} keyLabel="Header" />}
                  {tab === 'body' && (
                    <div className="stack" style={{ gap: 8 }}>
                      <Seg options={[{ id: 'json', label: 'JSON' }, { id: 'form', label: 'Form' }, { id: 'text', label: 'Text' }]} value={req.bodyType} onChange={(bodyType) => patchReq({ bodyType })} />
                      <textarea className="input mono" rows={8} value={req.body} aria-label="Body" placeholder={req.bodyType === 'json' ? '{ "name": "{{user}}" }' : req.bodyType === 'form' ? 'name=Alex&age=30' : ''} onChange={(e) => patchReq({ body: e.target.value })} />
                    </div>
                  )}
                  {tab === 'vars' && (
                    <div className="stack" style={{ gap: 8 }}>
                      <div className="row-tight"><span className="small muted grow">{'Write {{name}} in the address, headers or body – the value comes from here. Change {{base}} once to switch between local and live.'}</span><InfoTip pop title="Variables">They belong to the collection, so every request in it uses the same values.</InfoTip></div>
                      <Pairs rows={col.vars} onChange={(vars) => patchCol({ vars })} keyLabel="Variable" />
                      <div className="row-tight"><Btn className="sm ghost danger" icon={Trash2} onClick={removeCol}>Remove collection</Btn></div>
                    </div>
                  )}
                </div>
              </div>
              <div className="card"><div className="card-head"><Save size={16} /><h3>Answer</h3></div><div className="card-body">{busy ? <Loading /> : <Answer r={answer} />}</div></div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default {
  pages: { main: ApiTesterPage },
};
