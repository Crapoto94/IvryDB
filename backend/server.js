const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./db');
const storage = require('./storage');
// .env may sit next to the backend or at the repository root
const path = require('path');
require('dotenv').config({ path: [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')], quiet: true });
const apm = require('./apm');

const app = express();
const PORT = process.env.PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'app-super-secret';

app.use(cors());
app.use(express.json());

// Auth Middleware (App Level)
const authenticateApp = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.username;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid session' });
  }
};

// App Login
app.post('/api/app/login', (req, res) => {
  const { username, password } = req.body;
  const data = storage.readData();
  const user = data.users.find(u => u.username === username && u.password === password);
  
  if (user && user.endDate && new Date().toISOString().slice(0, 10) > user.endDate) {
    return res.status(401).json({ error: 'Account expired' });
  }
  if (user) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username });
  } else {
    res.status(401).json({ error: 'Invalid app credentials' });
  }
});

// GET Connections
app.get('/api/app/connections', authenticateApp, (req, res) => {
  const data = storage.readData();
  const user = data.users.find(u => u.username === req.user);
  res.json(user.connections || []);
});

// ADD/UPDATE Connection
app.post('/api/app/connections', authenticateApp, (req, res) => {
  const conn = req.body;
  const data = storage.readData();
  const userIndex = data.users.findIndex(u => u.username === req.user);
  
  if (!conn.id) conn.id = Date.now().toString();
  
  const existingIndex = data.users[userIndex].connections.findIndex(c => c.id === conn.id);
  if (existingIndex > -1) {
    data.users[userIndex].connections[existingIndex] = conn;
  } else {
    data.users[userIndex].connections.push(conn);
  }
  
  storage.writeData(data);
  res.json(conn);
});

// DELETE Connection
app.delete('/api/app/connections/:id', authenticateApp, (req, res) => {
  const data = storage.readData();
  const userIndex = data.users.findIndex(u => u.username === req.user);
  data.users[userIndex].connections = data.users[userIndex].connections.filter(c => c.id !== req.params.id);
  storage.writeData(data);
  res.json({ success: true });
});

// TEST Connection
app.post('/api/app/connections/test', authenticateApp, async (req, res) => {
  try {
    const pool = db.getPool(req.body);
    const client = await pool.connect();
    client.release();
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DB EXPLORER ENDPOINTS (Require a connection ID in header)
const injectDb = (req, res, next) => {
  const connId = req.headers['x-connection-id'];
  if (!connId) return res.status(400).json({ error: 'No connection selected' });

  const data = storage.readData();
  const user = data.users.find(u => u.username === req.user);
  const conn = user.connections.find(c => c.id === connId);
  
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  req.pool = db.getPool(conn);
  next();
};

app.get('/api/db/schemas', authenticateApp, injectDb, async (req, res) => {
  try {
    const result = await req.pool.query(`
      SELECT n.nspname AS schema_name,
        COALESCE((SELECT sum(pg_total_relation_size(c.oid)) FROM pg_class c
                  WHERE c.relnamespace = n.oid AND c.relkind IN ('r','m')), 0)::bigint AS size_bytes
      FROM pg_namespace n
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      ORDER BY n.nspname
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/db/tables', authenticateApp, injectDb, async (req, res) => {
  const { schema = 'public' } = req.query;
  try {
    const result = await req.pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = $1 ORDER BY table_name
    `, [schema]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/db/tables/:name', authenticateApp, injectDb, async (req, res) => {
  const { 
    schema = 'public', 
    page = 1, 
    limit = 30, 
    sortBy, 
    sortOrder = 'ASC', 
    filters 
  } = req.query;
  
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const parsedFilters = filters ? JSON.parse(filters) : {};
  
  try {
    // 1. Get column names for validation (to prevent SQL injection on ORDER BY)
    const colRes = await req.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, req.params.name]
    );
    const validColumns = colRes.rows.map(r => r.column_name);

    // 2. Build WHERE clause
    const whereClauses = [];
    const values = [];
    let valIdx = 1;

    Object.entries(parsedFilters).forEach(([col, val]) => {
      if (validColumns.includes(col) && val !== undefined && val !== '') {
        whereClauses.push(`"${col}"::text ILIKE $${valIdx}`);
        values.push(`%${val}%`);
        valIdx++;
      }
    });

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 3. Build ORDER BY clause
    let orderByStr = '';
    if (sortBy && validColumns.includes(sortBy)) {
      const order = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderByStr = `ORDER BY "${sortBy}" ${order}`;
    }

    // 4. Final Query with COUNT(*) OVER() to get total count in one go
    const query = `
      SELECT *, COUNT(*) OVER() as total_count 
      FROM "${schema}"."${req.params.name}"
      ${whereStr}
      ${orderByStr}
      LIMIT $${valIdx} OFFSET $${valIdx + 1}
    `;
    
    values.push(parseInt(limit), offset);
    
    const result = await req.pool.query(query, values);
    
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
    const rows = result.rows.map(({ total_count, ...row }) => row);

    res.json({ rows, totalCount });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: err.message }); 
  }
});

// Table properties (general, columns, constraints, indexes, generated DDL)
app.get('/api/db/tables/:name/properties', authenticateApp, injectDb, async (req, res) => {
  const { schema = 'public' } = req.query;
  const name = req.params.name;
  const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  try {
    const general = (await req.pool.query(`
      SELECT c.relkind, r.rolname AS owner, c.reltuples::bigint AS est_rows,
             pg_total_relation_size(c.oid) AS total_bytes, pg_relation_size(c.oid) AS table_bytes,
             obj_description(c.oid, 'pg_class') AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = $1 AND c.relname = $2`, [schema, name])).rows[0];
    if (!general) return res.status(404).json({ error: 'Table not found' });

    const columns = (await req.pool.query(`
      SELECT a.attnum AS position, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
             NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS "default",
             col_description(a.attrelid, a.attnum) AS comment
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`, [schema, name])).rows;

    const constraints = (await req.pool.query(`
      SELECT con.conname AS name,
             CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY' WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' ELSE con.contype::text END AS type,
             pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
      ORDER BY con.contype, con.conname`, [schema, name])).rows;

    const indexes = (await req.pool.query(
      `SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
      [schema, name])).rows;

    const colLines = columns.map(c =>
      `  ${qi(c.name)} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.default ? ' DEFAULT ' + c.default : ''}`);
    const conLines = constraints.map(c => `  CONSTRAINT ${qi(c.name)} ${c.definition}`);
    let ddl = `CREATE TABLE ${qi(schema)}.${qi(name)} (\n${colLines.concat(conLines).join(',\n')}\n);`;
    const pkIdx = new Set(constraints.filter(c => c.type === 'PRIMARY KEY' || c.type === 'UNIQUE').map(c => c.name));
    indexes.filter(i => !pkIdx.has(i.name)).forEach(i => { ddl += `\n${i.definition};`; });

    res.json({ general, columns, constraints, indexes, ddl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/db/query', authenticateApp, injectDb, async (req, res) => {
  try {
    const result = await req.pool.query(req.body.query);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DATABASE ROLES (PostgreSQL users) ---
const quoteIdent = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// Login roles with the schemas they can access (USAGE) and their expiry date
app.get('/api/db/roles', authenticateApp, injectDb, async (req, res) => {
  try {
    const result = await req.pool.query(`
      SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolvaliduntil AS valid_until,
        CASE WHEN r.rolsuper THEN ARRAY[]::text[] ELSE ARRAY(
          SELECT n.nspname::text FROM pg_namespace n
          WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
            AND has_schema_privilege(r.oid, n.oid, 'USAGE')
          ORDER BY n.nspname) END AS schemas
      FROM pg_roles r
      WHERE r.rolcanlogin AND r.rolname !~ '^pg_'
      ORDER BY r.rolname
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Set / clear the end date (VALID UNTIL) of a role. Body: { date: 'YYYY-MM-DD' | null }
app.put('/api/db/roles/:name/valid-until', authenticateApp, injectDb, async (req, res) => {
  const { date } = req.body;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  try {
    const exists = await req.pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1 AND rolcanlogin', [req.params.name]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Role not found' });
    const until = date ? `'${date} 23:59:59'` : `'infinity'`;
    await req.pool.query(`ALTER ROLE ${quoteIdent(req.params.name)} VALID UNTIL ${until}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SCHEMA MANAGEMENT ---
app.post('/api/db/schemas/:name/copy', authenticateApp, injectDb, async (req, res) => {
  const sourceSchema = req.params.name;
  const { targetSchema } = req.body;

  if (!targetSchema) return res.status(400).json({ error: 'Target schema name required' });

  try {
    // 1. Check if target schema already exists
    const schemaCheck = await req.pool.query(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
      [targetSchema]
    );
    if (schemaCheck.rows.length > 0) return res.status(400).json({ error: `Schema "${targetSchema}" already exists` });

    // 2. Create the target schema
    await req.pool.query(`CREATE SCHEMA "${targetSchema}"`);

    // 3. Get all tables from source schema
    const tablesRes = await req.pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = \'BASE TABLE\'',
      [sourceSchema]
    );

    // 4. Copy each table
    for (const row of tablesRes.rows) {
      const tableName = row.table_name;
      await req.pool.query(`CREATE TABLE "${targetSchema}"."${tableName}" AS SELECT * FROM "${sourceSchema}"."${tableName}"`);
    }

    res.json({ success: true, message: `Schema "${sourceSchema}" copied to "${targetSchema}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- TABLE MANAGEMENT ---
app.post('/api/db/tables/:name/action', authenticateApp, injectDb, async (req, res) => {
  const { action, schema = 'public', targetSchema, newName } = req.body;
  const tableName = req.params.name;

  if (!action) return res.status(400).json({ error: 'Action required' });

  try {
    switch (action) {
      case 'copy':
        if (!targetSchema || !newName) return res.status(400).json({ error: 'Target schema and new name required' });
        await req.pool.query(`CREATE TABLE "${targetSchema}"."${newName}" AS SELECT * FROM "${schema}"."${tableName}"`);
        break;
      case 'rename':
        if (!newName) return res.status(400).json({ error: 'New name required' });
        await req.pool.query(`ALTER TABLE "${schema}"."${tableName}" RENAME TO "${newName}"`);
        break;
      case 'truncate':
        await req.pool.query(`TRUNCATE TABLE "${schema}"."${tableName}"`);
        break;
      case 'delete':
        await req.pool.query(`DROP TABLE "${schema}"."${tableName}"`);
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- USER MANAGEMENT (Admin Only) ---
app.get('/api/app/users', authenticateApp, (req, res) => {
  if (req.user !== 'admin') return res.status(403).json({ error: 'Access denied' });
  const data = storage.readData();
  // Don't send passwords back (even if they are plain text for now)
  const users = data.users.map(({ password, ...u }) => u);
  res.json(users);
});

app.post('/api/app/users', authenticateApp, (req, res) => {
  if (req.user !== 'admin') return res.status(403).json({ error: 'Access denied' });
  const { username, password, endDate } = req.body;
  const data = storage.readData();
  if (data.users.find(u => u.username === username)) return res.status(400).json({ error: 'User exists' });

  data.users.push({ username, password, endDate: endDate || null, connections: [] });
  storage.writeData(data);
  res.json({ success: true });
});

app.put('/api/app/users/:username', authenticateApp, (req, res) => {
  if (req.user !== 'admin') return res.status(403).json({ error: 'Access denied' });
  const { password, endDate } = req.body;
  const data = storage.readData();
  const user = data.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });

  if (password) user.password = password;
  if (endDate !== undefined) user.endDate = endDate || null;
  storage.writeData(data);
  res.json({ success: true });
});

app.delete('/api/app/users/:username', authenticateApp, (req, res) => {
  if (req.user !== 'admin') return res.status(403).json({ error: 'Access denied' });
  if (req.params.username === 'admin') return res.status(400).json({ error: 'Cannot delete main admin' });
  
  const data = storage.readData();
  data.users = data.users.filter(u => u.username !== req.params.username);
  storage.writeData(data);
  res.json({ success: true });
});

// --- NOTIFICATIONS through APM (mail / SMS) ---
const adminOnly = (req, res, next) => (req.user === 'admin' ? next() : res.status(403).json({ error: 'Access denied' }));
app.get('/api/notify/status', authenticateApp, adminOnly, (req, res) => res.json({ configured: apm.isConfigured() }));
app.post('/api/notify/mail', authenticateApp, adminOnly, async (req, res) => {
  const { to, subject, content } = req.body || {};
  if (!to || !subject || !content) return res.status(400).json({ error: 'to, subject and content are required' });
  try { res.json(await apm.sendMail(to, subject, content)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.post('/api/notify/sms', authenticateApp, adminOnly, async (req, res) => {
  const { mobile, message } = req.body || {};
  if (!mobile || !message) return res.status(400).json({ error: 'mobile and message are required' });
  try { res.json(await apm.sendSms(mobile, message)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// --- BACKUPS ---
const backup = require('./backup');
backup.mount(app, authenticateApp);
backup.startScheduler();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
