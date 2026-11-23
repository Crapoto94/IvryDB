// Scheduled per-role backups (pg_dump, one gzip file per schema) and restore
// (same schema or a new schema). Needs the PostgreSQL client tools (pg_dump, psql) on the host.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const db = require('./db');
const storage = require('./storage');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'data', 'backups');
const FREQUENCIES = ['daily', 'weekly', 'monthly'];
const quoteIdent = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');

// ---- persistence (inside data.json, next to the app users) ----
const load = () => {
  const data = storage.readData();
  if (!data.backups) data.backups = { schedules: [], runs: [], restores: [] };
  data.backups.schedules ||= [];
  data.backups.runs ||= [];
  data.backups.restores ||= [];
  return data;
};
// Re-read before every write so concurrent edits of other parts of data.json are not lost.
const mutate = (fn) => {
  const data = load();
  const out = fn(data.backups, data);
  storage.writeData(data);
  return out;
};

const adminConnection = (connectionId) => {
  const admin = storage.readData().users.find((u) => u.username === 'admin');
  return (admin?.connections || []).find((c) => c.id === connectionId);
};

// ---- tools ----
const toolOk = (bin) => new Promise((resolve) => execFile(bin, ['--version'], (err, out) => resolve(err ? null : String(out).trim())));

const pgEnv = (conn) => ({ ...process.env, PGPASSWORD: conn.password || '', PGCONNECT_TIMEOUT: '10' });
const pgArgs = (conn) => ['-h', String(conn.host).trim(), '-p', String(conn.port || 5432), '-U', conn.user, '-d', conn.database];

// ---- which schemas belong to a role ----
async function roleSchemas(conn, role) {
  const pool = db.getPool(conn);
  const r = await pool.query(
    `SELECT n.nspname AS name
       FROM pg_namespace n, pg_roles r
      WHERE r.rolname = $1
        AND n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'public')
        AND (r.rolsuper OR has_schema_privilege(r.oid, n.oid, 'USAGE'))
      ORDER BY n.nspname`, [role]);
  return r.rows.map((x) => x.name);
}

// ---- dump ----
function dumpSchema(conn, schema, file) {
  return new Promise((resolve, reject) => {
    const args = [...pgArgs(conn), '--no-owner', '--no-privileges', '-n', quoteIdent(schema)];
    const child = spawn('pg_dump', args, { env: pgEnv(conn) });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', reject);
    const out = fs.createWriteStream(file);
    const gz = zlib.createGzip();
    child.stdout.pipe(gz).pipe(out);
    out.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return out.end(() => reject(new Error(err.trim() || `pg_dump exited with ${code}`)));
      out.on('finish', () => resolve(fs.statSync(file).size));
      // gz ends by itself when stdout closes
    });
  });
}

const running = new Set(); // schedule ids currently running

async function runBackup(scheduleId, trigger = 'manual') {
  const schedule = load().backups.schedules.find((s) => s.id === scheduleId);
  if (!schedule) throw Object.assign(new Error('Schedule not found'), { status: 404 });
  if (running.has(scheduleId)) throw Object.assign(new Error('Backup already running for this schedule'), { status: 409 });
  const conn = adminConnection(schedule.connectionId);
  if (!conn) throw Object.assign(new Error('Connection not found'), { status: 400 });
  if (!(await toolOk('pg_dump'))) throw Object.assign(new Error('pg_dump is not installed on the backend host'), { status: 503 });

  running.add(scheduleId);
  const runId = uid();
  const dir = path.join(BACKUP_DIR, slug(schedule.role), `${stamp()}_${runId}`);
  fs.mkdirSync(dir, { recursive: true });
  const run = { id: runId, scheduleId, role: schedule.role, connectionId: schedule.connectionId, trigger, startedAt: new Date().toISOString(), finishedAt: null, status: 'running', dir, schemas: [] };
  mutate((b) => { b.runs.unshift(run); });

  // runs in background; the caller gets the run id immediately
  (async () => {
    try {
      const schemas = await roleSchemas(conn, schedule.role);
      if (!schemas.length) throw new Error('This role has no schema to back up');
      for (let i = 0; i < schemas.length; i++) {
        const item = { name: schemas[i], file: `${String(i).padStart(3, '0')}_${slug(schemas[i])}.sql.gz`, ok: false, size: 0, error: null };
        run.schemas.push(item);
        try { item.size = await dumpSchema(conn, item.name, path.join(dir, item.file)); item.ok = true; }
        catch (e) { item.error = e.message; try { fs.unlinkSync(path.join(dir, item.file)); } catch { /* none */ } }
        mutate((b) => { const r = b.runs.find((x) => x.id === runId); if (r) r.schemas = run.schemas; });
      }
      const failed = run.schemas.filter((s) => !s.ok);
      run.status = failed.length === 0 ? 'success' : failed.length === run.schemas.length ? 'failed' : 'partial';
    } catch (e) {
      run.status = 'failed';
      run.error = e.message;
    } finally {
      run.finishedAt = new Date().toISOString();
      mutate((b) => { const i = b.runs.findIndex((x) => x.id === runId); if (i > -1) b.runs[i] = run; });
      running.delete(scheduleId);
      try { applyRetention(schedule); } catch (e) { console.error('[backup] retention:', e.message); }
      notify(schedule, run).catch((e) => console.error('[backup] notify:', e.message));
    }
  })();
  return run;
}

function applyRetention(schedule) {
  const keep = Math.max(1, Number(schedule.retention) || 7);
  mutate((b) => {
    const mine = b.runs.filter((r) => r.scheduleId === schedule.id && r.status !== 'running');
    for (const old of mine.slice(keep)) {
      if (old.dir && path.resolve(old.dir).startsWith(path.resolve(BACKUP_DIR) + path.sep)) fs.rmSync(old.dir, { recursive: true, force: true });
      b.runs.splice(b.runs.findIndex((r) => r.id === old.id), 1);
    }
  });
}

async function notify(schedule, run) {
  const apm = require('./apm');
  if (!apm.isConfigured() || !schedule.notifyEmail) return;
  if (schedule.notifyOn !== 'always' && run.status === 'success') return;
  const lines = run.schemas.map((s) => `<li>${s.name}: ${s.ok ? `OK (${(s.size / 1048576).toFixed(1)} MB)` : `ERREUR - ${String(s.error).replace(/</g, '&lt;')}`}</li>`).join('');
  await apm.sendMail(schedule.notifyEmail, `[IvryDB] Sauvegarde ${schedule.role} : ${run.status}`,
    `<p>Sauvegarde du rôle <b>${schedule.role}</b> terminée avec le statut <b>${run.status}</b>.</p>${run.error ? `<p>${String(run.error).replace(/</g, '&lt;')}</p>` : ''}<ul>${lines}</ul>`, { is_raw: false });
}

// ---- scheduler ----
function dueNow(s, now = new Date()) {
  if (!s.enabled) return false;
  const [hh, mm] = String(s.time || '02:00').split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return false;
  if (s.frequency === 'weekly' && now.getDay() !== Number(s.weekday ?? 1)) return false;
  if (s.frequency === 'monthly' && now.getDate() !== Number(s.day ?? 1)) return false;
  // at most one scheduled run per calendar day (also catches up if the server was down at the exact minute)
  return s.lastSlot !== `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function startScheduler() {
  // runs left "running" by a previous process can never finish
  mutate((b) => { b.runs.forEach((r) => { if (r.status === 'running') { r.status = 'failed'; r.error = 'Interrupted by server restart'; r.finishedAt = new Date().toISOString(); } }); });
  setInterval(() => {
    const now = new Date();
    const local = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    for (const s of load().backups.schedules) {
      if (!dueNow(s, now) || running.has(s.id)) continue;
      mutate((b) => { const x = b.schedules.find((y) => y.id === s.id); if (x) x.lastSlot = local; });
      runBackup(s.id, 'schedule').catch((e) => console.error(`[backup] schedule ${s.role}:`, e.message));
    }
  }, 60 * 1000).unref();
}

// ---- restore ----
// Rewrites the schema name in a plain pg_dump script, outside COPY data blocks.
function makeRenamer(src, dst) {
  if (src === dst) return (l) => l;
  const qSrc = `"${src}"`;
  const dstSql = /^[a-z_][a-z0-9_]*$/.test(dst) ? dst : quoteIdent(dst);
  const bare = /^[a-z_][a-z0-9_]*$/.test(src);
  const reBare = bare ? new RegExp(`(?<![\\w"$.])${src}(?=\\.)`, 'g') : null;
  const reCreate = bare ? new RegExp(`(\\bSCHEMA\\s+)${src}\\b`, 'g') : null;
  return (line) => {
    let l = line.split(qSrc).join(quoteIdent(dst));
    if (bare) l = l.replace(reBare, dstSql).replace(reCreate, `$1${dstSql}`);
    return l;
  };
}

async function* restoreScript(file, src, dst, replace, role) {
  if (replace) yield `DROP SCHEMA IF EXISTS ${quoteIdent(dst)} CASCADE;\n`;
  const rename = makeRenamer(src, dst);
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let inCopy = false;
  for await (const line of rl) {
    if (inCopy) { if (line === '\\.') inCopy = false; yield line + '\n'; continue; }
    if (/^COPY .* FROM stdin;$/.test(line)) { inCopy = true; yield rename(line) + '\n'; continue; }
    yield rename(line) + '\n';
  }
  if (role) {
    const s = quoteIdent(dst), r = quoteIdent(role);
    yield `GRANT ALL ON SCHEMA ${s} TO ${r};\nGRANT ALL ON ALL TABLES IN SCHEMA ${s} TO ${r};\nGRANT ALL ON ALL SEQUENCES IN SCHEMA ${s} TO ${r};\nGRANT ALL ON ALL FUNCTIONS IN SCHEMA ${s} TO ${r};\n`;
  }
}

async function restoreSchema({ runId, schema, targetSchema, mode }) {
  const b = load().backups;
  const run = b.runs.find((r) => r.id === runId);
  if (!run) throw Object.assign(new Error('Backup run not found'), { status: 404 });
  const item = run.schemas.find((s) => s.name === schema && s.ok);
  if (!item) throw Object.assign(new Error('Schema not available in this backup'), { status: 400 });
  const file = path.join(run.dir, item.file);
  if (!path.resolve(file).startsWith(path.resolve(BACKUP_DIR) + path.sep) || !fs.existsSync(file)) throw Object.assign(new Error('Backup file missing'), { status: 410 });
  const conn = adminConnection(run.connectionId);
  if (!conn) throw Object.assign(new Error('Connection not found'), { status: 400 });
  if (!(await toolOk('psql'))) throw Object.assign(new Error('psql is not installed on the backend host'), { status: 503 });

  const replace = mode === 'replace';
  const dst = replace ? schema : String(targetSchema || '');
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(dst) || /^pg_/i.test(dst) || ['information_schema', 'public'].includes(dst)) throw Object.assign(new Error('Invalid target schema name'), { status: 400 });
  const pool = db.getPool(conn);
  const exists = (await pool.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [dst])).rowCount > 0;
  if (!replace && exists) throw Object.assign(new Error(`Schema "${dst}" already exists`), { status: 409 });
  if (replace && !exists) throw Object.assign(new Error('Schema no longer exists: restore it into a new schema instead'), { status: 409 });
  const roleExists = (await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [run.role])).rowCount > 0;

  const id = uid();
  const rec = { id, runId, role: run.role, schema, target: dst, mode: replace ? 'replace' : 'new', startedAt: new Date().toISOString(), finishedAt: null, status: 'running', error: null };
  mutate((x) => { x.restores.unshift(rec); x.restores.length = Math.min(x.restores.length, 100); });

  (async () => {
    try {
      const child = spawn('psql', [...pgArgs(conn), '-v', 'ON_ERROR_STOP=1', '-1', '-q', '-f', '-'], { env: pgEnv(conn) });
      let err = '';
      child.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
      const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim() || `psql exited with ${c}`)))); });
      child.stdin.on('error', () => { /* reported through the exit code */ });
      await pipeline(Readable.from(restoreScript(file, schema, dst, replace, roleExists ? run.role : null)), child.stdin).catch(() => {});
      await done;
      rec.status = 'success';
    } catch (e) { rec.status = 'failed'; rec.error = e.message; }
    rec.finishedAt = new Date().toISOString();
    mutate((x) => { const i = x.restores.findIndex((r) => r.id === id); if (i > -1) x.restores[i] = rec; });
  })();
  return rec;
}

// ---- HTTP API ----
function mount(app, authenticateApp) {
  const admin = (req, res, next) => (req.user === 'admin' ? next() : res.status(403).json({ error: 'Access denied' }));
  const wrap = (fn) => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const A = [authenticateApp, admin];

  app.get('/api/backups/status', ...A, wrap(async () => ({
    pg_dump: await toolOk('pg_dump'), psql: await toolOk('psql'), dir: BACKUP_DIR, apm: require('./apm').isConfigured(),
  })));

  app.get('/api/backups/role-schemas', ...A, wrap(async (req) => {
    const conn = adminConnection(req.query.connectionId);
    if (!conn) throw Object.assign(new Error('Connection not found'), { status: 400 });
    return roleSchemas(conn, String(req.query.role || ''));
  }));

  app.get('/api/backups/schedules', ...A, wrap(() => load().backups.schedules.map((s) => ({ ...s, running: running.has(s.id) }))));

  const cleanSchedule = async (b, existing) => {
    const s = { ...existing };
    if (b.connectionId !== undefined) { if (!adminConnection(b.connectionId)) throw Object.assign(new Error('Unknown connection'), { status: 400 }); s.connectionId = b.connectionId; }
    if (b.role !== undefined) { if (!/^[A-Za-z0-9_$-]{1,63}$/.test(b.role)) throw Object.assign(new Error('Invalid role'), { status: 400 }); s.role = b.role; }
    if (b.frequency !== undefined) { if (!FREQUENCIES.includes(b.frequency)) throw Object.assign(new Error('Invalid frequency'), { status: 400 }); s.frequency = b.frequency; }
    if (b.time !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) throw Object.assign(new Error('Invalid time'), { status: 400 }); s.time = b.time; }
    if (b.weekday !== undefined) s.weekday = Math.min(6, Math.max(0, parseInt(b.weekday, 10) || 0));
    if (b.day !== undefined) s.day = Math.min(28, Math.max(1, parseInt(b.day, 10) || 1));
    if (b.retention !== undefined) s.retention = Math.min(365, Math.max(1, parseInt(b.retention, 10) || 7));
    if (b.enabled !== undefined) s.enabled = !!b.enabled;
    if (b.notifyEmail !== undefined) s.notifyEmail = String(b.notifyEmail).trim();
    if (b.notifyOn !== undefined) s.notifyOn = b.notifyOn === 'always' ? 'always' : 'failure';
    return s;
  };

  app.post('/api/backups/schedules', ...A, wrap(async (req) => {
    const s = await cleanSchedule(req.body, { id: uid(), enabled: true, frequency: 'daily', time: '02:00', weekday: 1, day: 1, retention: 7, notifyOn: 'failure', notifyEmail: '', createdAt: new Date().toISOString() });
    if (!s.connectionId || !s.role) throw Object.assign(new Error('connectionId and role are required'), { status: 400 });
    mutate((b) => { b.schedules.push(s); });
    return s;
  }));

  app.put('/api/backups/schedules/:id', ...A, wrap(async (req) => {
    const cur = load().backups.schedules.find((s) => s.id === req.params.id);
    if (!cur) throw Object.assign(new Error('Not found'), { status: 404 });
    const s = await cleanSchedule(req.body, cur);
    mutate((b) => { b.schedules[b.schedules.findIndex((x) => x.id === s.id)] = s; });
    return s;
  }));

  app.delete('/api/backups/schedules/:id', ...A, wrap(async (req) => {
    mutate((b) => { b.schedules = b.schedules.filter((s) => s.id !== req.params.id); });
    return { success: true };
  }));

  app.post('/api/backups/schedules/:id/run', ...A, wrap((req) => runBackup(req.params.id, 'manual')));

  app.get('/api/backups/runs', ...A, wrap((req) => {
    let runs = load().backups.runs;
    if (req.query.role) runs = runs.filter((r) => r.role === req.query.role);
    return runs.slice(0, Math.min(200, parseInt(req.query.limit, 10) || 50)).map(({ dir, ...r }) => r);
  }));

  // Download one dump file (gzip'ed SQL) of a run: the schema is addressed by its index in run.schemas
  app.get('/api/backups/runs/:id/files/:index', authenticateApp, admin, (req, res) => {
    const run = load().backups.runs.find((r) => r.id === req.params.id);
    const item = run?.schemas[parseInt(req.params.index, 10)];
    if (!item || !item.ok) return res.status(404).json({ error: 'File not found' });
    const file = path.join(run.dir, item.file);
    if (!path.resolve(file).startsWith(path.resolve(BACKUP_DIR) + path.sep) || !fs.existsSync(file)) return res.status(410).json({ error: 'Backup file no longer on disk' });
    res.download(file, `${slug(run.role)}_${slug(item.name)}_${run.startedAt.slice(0, 19).replace(/[-:]/g, '').replace('T', '_')}.sql.gz`);
  });

  app.delete('/api/backups/runs/:id', ...A, wrap(async (req) => {
    mutate((b) => {
      const r = b.runs.find((x) => x.id === req.params.id);
      if (!r) throw Object.assign(new Error('Not found'), { status: 404 });
      if (r.status === 'running') throw Object.assign(new Error('Run in progress'), { status: 409 });
      if (r.dir && path.resolve(r.dir).startsWith(path.resolve(BACKUP_DIR) + path.sep)) fs.rmSync(r.dir, { recursive: true, force: true });
      b.runs = b.runs.filter((x) => x.id !== r.id);
    });
    return { success: true };
  }));

  // body: { runId, schema, mode: 'new'|'replace', targetSchema?, confirm? }
  app.post('/api/backups/restore', ...A, wrap(async (req) => {
    const { runId, schema, mode, targetSchema, confirm } = req.body || {};
    if (mode === 'replace' && confirm !== schema) throw Object.assign(new Error('Type the schema name to confirm the replacement'), { status: 400 });
    return restoreSchema({ runId, schema, mode, targetSchema });
  }));

  app.get('/api/backups/restores', ...A, wrap((req) => {
    let l = load().backups.restores;
    if (req.query.role) l = l.filter((r) => r.role === req.query.role);
    return l.slice(0, 30);
  }));
}

module.exports = { mount, startScheduler, dueNow, makeRenamer, restoreScript };
