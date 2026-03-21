const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./db');
const storage = require('./storage');
require('dotenv').config();

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
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
      ORDER BY schema_name
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
  const { schema = 'public' } = req.query;
  try {
    const result = await req.pool.query(`SELECT * FROM "${schema}"."${req.params.name}" LIMIT 100`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/db/query', authenticateApp, injectDb, async (req, res) => {
  try {
    const result = await req.pool.query(req.body.query);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  const { username, password } = req.body;
  const data = storage.readData();
  if (data.users.find(u => u.username === username)) return res.status(400).json({ error: 'User exists' });
  
  data.users.push({ username, password, connections: [] });
  storage.writeData(data);
  res.json({ success: true });
});

app.put('/api/app/users/:username', authenticateApp, (req, res) => {
  if (req.user !== 'admin') return res.status(403).json({ error: 'Access denied' });
  const { password } = req.body;
  const data = storage.readData();
  const user = data.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  
  user.password = password;
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
