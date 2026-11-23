import React, { useState, useEffect, useCallback } from 'react';
import { Play, Plus, Trash2, Edit3, RotateCcw, CheckCircle2, AlertCircle, Loader2, XCircle, Mail } from 'lucide-react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const emptyForm = { id: '', connectionId: '', role: '', frequency: 'daily', time: '02:00', weekday: 1, day: 1, retention: 7, enabled: true, notifyEmail: '', notifyOn: 'failure' };

export default function Backups({ apiFetch, connections }) {
  const [tab, setTab] = useState('schedules');
  const [status, setStatus] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [form, setForm] = useState(null); // schedule being created / edited
  const [formRoles, setFormRoles] = useState([]);
  const [msg, setMsg] = useState(null); // { type: 'ok' | 'err', text }

  // restore tab
  const [role, setRole] = useState('');
  const [runId, setRunId] = useState('');
  const [picks, setPicks] = useState({}); // schema -> { on, mode, target }
  const [restores, setRestores] = useState([]);

  const call = useCallback(async (url, options) => {
    const res = await apiFetch(url, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
    return body;
  }, [apiFetch]);

  const refresh = useCallback(async () => {
    try {
      const [s, r, x] = await Promise.all([call('/api/backups/schedules'), call('/api/backups/runs?limit=100'), call('/api/backups/restores')]);
      setSchedules(s); setRuns(r); setRestores(x);
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  }, [call]);

  useEffect(() => { call('/api/backups/status').then(setStatus).catch(() => {}); refresh(); }, [call, refresh]);

  // poll while something is running
  const busy = runs.some((r) => r.status === 'running') || restores.some((r) => r.status === 'running');
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const openForm = async (s) => {
    const f = s ? { ...emptyForm, ...s } : { ...emptyForm, connectionId: connections[0]?.id || '' };
    setForm(f);
    loadRoles(f.connectionId);
  };
  const loadRoles = async (connectionId) => {
    setFormRoles([]);
    if (!connectionId) return;
    try {
      const r = await call('/api/db/roles', { headers: { 'x-connection-id': connectionId } });
      setFormRoles(r.map((x) => x.name));
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const saveForm = async (e) => {
    e.preventDefault();
    try {
      const body = JSON.stringify(form);
      if (form.id) await call(`/api/backups/schedules/${form.id}`, { method: 'PUT', body });
      else await call('/api/backups/schedules', { method: 'POST', body });
      setForm(null); refresh();
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  };

  const runNow = async (s) => {
    try { await call(`/api/backups/schedules/${s.id}/run`, { method: 'POST', body: '{}' }); setMsg({ type: 'ok', text: `Backup of ${s.role} started` }); refresh(); }
    catch (e) { setMsg({ type: 'err', text: e.message }); }
  };
  const removeSchedule = async (s) => {
    if (!confirm(`Delete the schedule for ${s.role}? Existing backup files are kept.`)) return;
    try { await call(`/api/backups/schedules/${s.id}`, { method: 'DELETE' }); refresh(); } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };
  const removeRun = async (r) => {
    if (!confirm('Delete this backup and its files?')) return;
    try { await call(`/api/backups/runs/${r.id}`, { method: 'DELETE' }); if (runId === r.id) setRunId(''); refresh(); } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  // ---- restore ----
  const roleNames = [...new Set(runs.map((r) => r.role).concat(schedules.map((s) => s.role)))].sort();
  const roleRuns = runs.filter((r) => r.role === role && r.status !== 'running' && r.schemas.some((s) => s.ok));
  const run = runs.find((r) => r.id === runId);

  const pickRun = (id) => {
    setRunId(id);
    const r = runs.find((x) => x.id === id);
    const p = {};
    (r?.schemas || []).filter((s) => s.ok).forEach((s) => { p[s.name] = { on: false, mode: 'new', target: `${s.name}_restore_${today()}` }; });
    setPicks(p);
  };
  const setPick = (name, patch) => setPicks({ ...picks, [name]: { ...picks[name], ...patch } });

  const restore = async () => {
    const chosen = Object.entries(picks).filter(([, p]) => p.on);
    if (!chosen.length) return;
    for (const [name, p] of chosen) {
      let confirmText;
      if (p.mode === 'replace') {
        confirmText = prompt(`Restoring "${name}" in place will DROP the current schema and replace it with this backup.\nType the schema name to confirm:`);
        if (confirmText !== name) { setMsg({ type: 'err', text: `Cancelled: "${name}" not confirmed` }); return; }
      }
      try {
        await call('/api/backups/restore', { method: 'POST', body: JSON.stringify({ runId, schema: name, mode: p.mode, targetSchema: p.target, confirm: confirmText }) });
        setMsg({ type: 'ok', text: `Restore of ${name} started` });
      } catch (e) { setMsg({ type: 'err', text: `${name}: ${e.message}` }); }
    }
    refresh();
  };

  const [mail, setMail] = useState({ to: '', open: false });
  const testMail = async () => {
    try {
      await call('/api/notify/mail', { method: 'POST', body: JSON.stringify({ to: mail.to, subject: '[IvryDB] Test', content: '<p>APM connection test from IvryDB.</p>' }) });
      setMsg({ type: 'ok', text: 'Test mail sent' }); setMail({ to: '', open: false });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const lastRun = (s) => runs.find((r) => r.scheduleId === s.id);
  const connName = (id) => { const c = connections.find((x) => x.id === id); return c ? (c.name || c.host) : '?'; };
  const pill = (st) => <span className={`status-pill ${st === 'success' ? 'active' : st === 'running' ? 'running' : 'expired'}`}>{st}</span>;

  return (
    <div className="content-page animate-fade-in">
      <header className="content-header">
        <div className="header-title">
          <h2>Backups</h2>
          <p className="text-muted">Scheduled pg_dump per role, restore per role</p>
        </div>
        <div className="row-actions">
          {status && <>
            <span className={`status-pill ${status.pg_dump ? 'active' : 'expired'}`} title={status.pg_dump || 'pg_dump not found on the backend host'}>pg_dump</span>
            <span className={`status-pill ${status.psql ? 'active' : 'expired'}`} title={status.psql || 'psql not found on the backend host'}>psql</span>
            <span className={`status-pill ${status.apm ? 'active' : 'expired'}`} title={status.apm ? 'APM configured' : 'APM_API_URL / APM_API_KEY missing'}>APM</span>
          </>}
          {status?.apm && <button className="row-icon-btn" title="Send a test mail through APM" onClick={() => setMail({ ...mail, open: !mail.open })}><Mail size={14} /></button>}
          {tab === 'schedules' && <button className="action-btn" onClick={() => openForm(null)}><Plus size={18} /> New schedule</button>}
        </div>
      </header>

      {mail.open && (
        <div className="glass-panel pad inline-form">
          <input type="email" placeholder="recipient@domain.fr" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} />
          <button className="btn-primary" onClick={testMail} disabled={!mail.to}>Send test mail</button>
        </div>
      )}

      {msg && (
        <div className={msg.type === 'ok' ? 'status-success animate-fade-in' : 'error-card animate-fade-in'} onClick={() => setMsg(null)}>
          {msg.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {msg.text}
        </div>
      )}
      {status && !status.pg_dump && <div className="error-card"><AlertCircle size={16} /> pg_dump / psql are not installed on the backend host: schedules are saved but backups will fail until the client tools are installed (the Docker image installs them).</div>}

      <div className="nav-tabs users-tabs">
        <button className={`tab ${tab === 'schedules' ? 'active' : ''}`} onClick={() => setTab('schedules')}>Schedules &amp; history</button>
        <button className={`tab ${tab === 'restore' ? 'active' : ''}`} onClick={() => setTab('restore')}>Restore</button>
      </div>

      {tab === 'schedules' && (<>
        <div className="user-list glass-panel">
          <table>
            <thead><tr><th>Role</th><th>Connection</th><th>When</th><th>Keep</th><th>Last run</th><th>Enabled</th><th>Actions</th></tr></thead>
            <tbody>
              {schedules.map((s) => {
                const lr = lastRun(s);
                return (
                  <tr key={s.id}>
                    <td>{s.role}</td>
                    <td>{connName(s.connectionId)}</td>
                    <td>{s.frequency === 'daily' ? 'Every day' : s.frequency === 'weekly' ? `Every ${DAYS[s.weekday]}` : `Monthly, day ${s.day}`} at {s.time}</td>
                    <td>{s.retention}</td>
                    <td>{lr ? <>{pill(lr.status)} <span className="text-muted small">{fmtDate(lr.startedAt)}</span></> : '—'}</td>
                    <td>{s.enabled ? 'Yes' : 'No'}</td>
                    <td><div className="row-actions">
                      <button className="row-icon-btn" title="Run now" disabled={s.running} onClick={() => runNow(s)}>{s.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}</button>
                      <button className="row-icon-btn" onClick={() => openForm(s)}><Edit3 size={14} /></button>
                      <button className="row-icon-btn text-error" onClick={() => removeSchedule(s)}><Trash2 size={14} /></button>
                    </div></td>
                  </tr>
                );
              })}
              {!schedules.length && <tr><td colSpan={7} className="text-muted">No schedule yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <h3 className="section-title">History</h3>
        <div className="user-list glass-panel">
          <table>
            <thead><tr><th>Date</th><th>Role</th><th>Status</th><th>Schemas</th><th>Size</th><th>Trigger</th><th></th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} title={r.error || r.schemas.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`).join('\n')}>
                  <td>{fmtDate(r.startedAt)}</td><td>{r.role}</td><td>{pill(r.status)}</td>
                  <td>{r.schemas.filter((s) => s.ok).length}/{r.schemas.length}</td>
                  <td>{fmtSize(r.schemas.reduce((a, s) => a + (s.size || 0), 0))}</td>
                  <td>{r.trigger}</td>
                  <td>{r.status !== 'running' && <button className="row-icon-btn text-error" onClick={() => removeRun(r)}><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
              {!runs.length && <tr><td colSpan={7} className="text-muted">No backup yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}

      {tab === 'restore' && (<>
        <div className="glass-panel pad inline-form">
          <label>Role
            <select className="conn-select" value={role} onChange={(e) => { setRole(e.target.value); setRunId(''); setPicks({}); }}>
              <option value="">Select a role…</option>
              {roleNames.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>Backup
            <select className="conn-select" value={runId} onChange={(e) => pickRun(e.target.value)} disabled={!role}>
              <option value="">Select a backup…</option>
              {roleRuns.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.startedAt)} — {r.schemas.filter((s) => s.ok).length} schema(s) [{r.status}]</option>)}
            </select>
          </label>
        </div>

        {run && (
          <div className="user-list glass-panel">
            <table>
              <thead><tr><th></th><th>Schema</th><th>Size</th><th>Restore as</th><th>Target schema</th></tr></thead>
              <tbody>
                {run.schemas.filter((s) => s.ok).map((s) => {
                  const p = picks[s.name] || {};
                  return (
                    <tr key={s.name}>
                      <td><input type="checkbox" checked={!!p.on} onChange={(e) => setPick(s.name, { on: e.target.checked })} /></td>
                      <td>{s.name}</td><td>{fmtSize(s.size)}</td>
                      <td>
                        <select className="conn-select" value={p.mode} onChange={(e) => setPick(s.name, { mode: e.target.value })}>
                          <option value="new">A new schema</option>
                          <option value="replace">Replace the current one</option>
                        </select>
                      </td>
                      <td>{p.mode === 'replace' ? <span className="text-error small">{s.name} will be dropped and recreated</span> : <input className="date-input" value={p.target || ''} onChange={(e) => setPick(s.name, { target: e.target.value })} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="pad"><button className="action-btn" onClick={restore} disabled={!Object.values(picks).some((p) => p.on)}><RotateCcw size={16} /> Restore selected</button></div>
          </div>
        )}

        <h3 className="section-title">Restore history</h3>
        <div className="user-list glass-panel">
          <table>
            <thead><tr><th>Date</th><th>Role</th><th>Schema</th><th>Into</th><th>Status</th></tr></thead>
            <tbody>
              {restores.filter((r) => !role || r.role === role).map((r) => (
                <tr key={r.id} title={r.error || ''}>
                  <td>{fmtDate(r.startedAt)}</td><td>{r.role}</td><td>{r.schema}</td>
                  <td>{r.target} <span className="text-muted small">({r.mode})</span></td><td>{pill(r.status)}</td>
                </tr>
              ))}
              {!restores.length && <tr><td colSpan={5} className="text-muted">No restore yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}

      {form && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal glass-premium animate-zoom">
            <div className="modal-header">
              <h3>{form.id ? 'Edit schedule' : 'New schedule'}</h3>
              <button onClick={() => setForm(null)} className="close-btn"><XCircle size={20} /></button>
            </div>
            <form onSubmit={saveForm} className="modal-form">
              <div className="form-row">
                <div className="form-group"><label>Connection</label>
                  <select className="conn-select" value={form.connectionId} onChange={(e) => { setForm({ ...form, connectionId: e.target.value, role: '' }); loadRoles(e.target.value); }} required>
                    {connections.map((c) => <option key={c.id} value={c.id}>{c.name || c.host}</option>)}
                  </select></div>
                <div className="form-group"><label>Role</label>
                  <select className="conn-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} required>
                    <option value="">Select…</option>
                    {formRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Frequency</label>
                  <select className="conn-select" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                    <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                  </select></div>
                <div className="form-group"><label>Time</label><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required /></div>
              </div>
              {form.frequency === 'weekly' && <div className="form-group"><label>Day of week</label>
                <select className="conn-select" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>}
              {form.frequency === 'monthly' && <div className="form-group"><label>Day of month (1-28)</label><input type="number" min="1" max="28" value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })} /></div>}
              <div className="form-row">
                <div className="form-group"><label>Backups to keep</label><input type="number" min="1" max="365" value={form.retention} onChange={(e) => setForm({ ...form, retention: Number(e.target.value) })} /></div>
                <div className="form-group"><label>Enabled</label><select className="conn-select" value={form.enabled ? '1' : '0'} onChange={(e) => setForm({ ...form, enabled: e.target.value === '1' })}><option value="1">Yes</option><option value="0">No</option></select></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Notify (mail, via APM)</label><input value={form.notifyEmail} onChange={(e) => setForm({ ...form, notifyEmail: e.target.value })} placeholder="a@x.fr, b@y.fr" /></div>
                <div className="form-group"><label>Notify on</label><select className="conn-select" value={form.notifyOn} onChange={(e) => setForm({ ...form, notifyOn: e.target.value })}><option value="failure">Failure only</option><option value="always">Every run</option></select></div>
              </div>
              <div className="modal-footer"><button type="submit" className="btn-primary full">Save schedule</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
