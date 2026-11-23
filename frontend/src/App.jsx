import React, { useState, useEffect } from 'react';
import { Database, Table as TableIcon, Terminal, Search, Play, RefreshCw, AlertCircle, Loader2, LogOut, Layers, Server, ChevronRight, ChevronDown, Folder, Plus, Trash2, CheckCircle2, XCircle, Edit3, ArrowLeft, Users, Shield, Settings, Activity, Cpu, HardDrive } from 'lucide-react';
import Backups from './Backups.jsx';

const formatBytes = (b) => {
  b = Number(b) || 0;
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${b >= 100 ? Math.round(b) : b.toFixed(1)} ${u[i]}`;
};

function App() {
  const [appToken, setAppToken] = useState(localStorage.getItem('app_token'));
  const [appUser, setAppUser] = useState(localStorage.getItem('app_user'));
  const [view, setView] = useState('login'); // 'login', 'connections', 'explorer', 'users'
  const [connections, setConnections] = useState([]);
  const [selectedConnId, setSelectedConnId] = useState(null);
  
  // App Users State
  const [appUsers, setAppUsers] = useState([]);
  const [usersTab, setUsersTab] = useState('roles'); // 'roles' (PostgreSQL) | 'app'
  const [dbRoles, setDbRoles] = useState([]);
  const [expandedRoles, setExpandedRoles] = useState(new Set());

  // Explorer State
  const [schemas, setSchemas] = useState([]);
  const [expandedSchemas, setExpandedSchemas] = useState(new Set(['public']));
  const [schemaTables, setSchemaTables] = useState({});
  const [selectedSchema, setSelectedSchema] = useState('public');
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableTab, setTableTab] = useState('data'); // 'data' | 'general' | 'columns' | 'constraints' | 'sql'
  const [tableProps, setTableProps] = useState(null);
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [sqlQuery, setSqlQuery] = useState('');
  const [schemaFilter, setSchemaFilter] = useState('');
  const [groupByPrefix, setGroupByPrefix] = useState(true);
  const [openGroups, setOpenGroups] = useState(new Set());

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Table Pagination, Filtering, Sorting State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [totalCount, setTotalCount] = useState(0);
  const [sortConfig, setSortConfig] = useState({ column: null, direction: 'ASC' });
  const [tableFilters, setTableFilters] = useState({});

  // App Login State
  const [appCreds, setAppCreds] = useState({ username: 'admin', password: '' });

  // Connection/User Form State
  const [isEditing, setIsEditing] = useState(false); // Can be 'connection' or 'user'
  const [connForm, setConnForm] = useState({ id: '', name: '', host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', password: '' });
  const [userForm, setUserForm] = useState({ username: '', password: '', endDate: '' });
  const [schemaForm, setSchemaForm] = useState({ name: '' });
  const [tableForm, setTableForm] = useState({ name: '', columns: 'id SERIAL PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' });

  // Table/Schema Management State
  const [mgmtAction, setMgmtAction] = useState(null); // 'copy_table', 'rename_table', 'truncate_table', 'delete_table', 'copy_schema'
  const [mgmtForm, setMgmtForm] = useState({ targetSchema: '', newName: '', sourceName: '', sourceSchema: '' });

  useEffect(() => {
    if (appToken) {
      setView('connections');
      fetchConnections();
    }
  }, [appToken]);

  const apiFetch = async (url, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${appToken}`,
      ...options.headers
    };
    if (selectedConnId) headers['x-connection-id'] = selectedConnId;
    
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) handleLogout();
    return res;
  };

  const handleAppLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/app/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appCreds),
      });
      const result = await res.json();
      if (res.ok) {
        setAppToken(result.token);
        setAppUser(result.username);
        localStorage.setItem('app_token', result.token);
        localStorage.setItem('app_user', result.username);
        setView('connections');
      } else {
        setError(result.error);
      }
    } catch (err) { setError('Backend unreachable'); }
    finally { setLoading(false); }
  };

  const handleLogout = () => {
    setAppToken(null);
    setAppUser(null);
    localStorage.removeItem('app_token');
    localStorage.removeItem('app_user');
    setView('login');
    setConnections([]);
    setSelectedConnId(null);
  };

  const fetchConnections = async () => {
    const res = await apiFetch('/api/app/connections');
    if (res.ok) setConnections(await res.json());
  };

  const testConnection = async (config) => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/app/connections/test', { method: 'POST', body: JSON.stringify(config) });
      if (res.ok) alert('Connection successful!');
      else alert('Failed: ' + (await res.json()).error);
    } catch (e) { alert('Test failed'); }
    finally { setLoading(false); }
  };

  const saveConnection = async (e) => {
    e.preventDefault();
    const res = await apiFetch('/api/app/connections', { method: 'POST', body: JSON.stringify(connForm) });
    if (res.ok) { fetchConnections(); setIsEditing(false); setConnForm({ id: '', name: '', host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', password: '' }); }
  };

  const deleteConnection = async (id) => {
    if (!confirm('Delete this connection?')) return;
    const res = await apiFetch(`/api/app/connections/${id}`, { method: 'DELETE' });
    if (res.ok) fetchConnections();
  };

  // --- USER MANAGEMENT ---
  const fetchAppUsers = async () => {
    const res = await apiFetch('/api/app/users');
    if (res.ok) setAppUsers(await res.json());
  };

  const saveAppUser = async (e) => {
    e.preventDefault();
    const isUpdate = appUsers.some(u => u.username === userForm.username);
    const url = isUpdate ? `/api/app/users/${userForm.username}` : '/api/app/users';
    const method = isUpdate ? 'PUT' : 'POST';
    
    const res = await apiFetch(url, { method, body: JSON.stringify(userForm) });
    if (res.ok) { 
      fetchAppUsers(); 
      setIsEditing(false); 
      setUserForm({ username: '', password: '', endDate: '' });
    } else {
      const err = await res.json(); 
      alert(err.error); 
    }
  };

  const deleteAppUser = async (username) => {
    if (!confirm(`Delete user ${username}?`)) return;
    const res = await apiFetch(`/api/app/users/${username}`, { method: 'DELETE' });
    if (res.ok) fetchAppUsers();
  };

  // --- EXPLORER ---
  const startExplorer = (conn) => {
    setSelectedConnId(conn.id);
    setView('explorer');
    setExpandedSchemas(new Set(['public']));
    setSchemaTables({});
    setSelectedSchema('public');
    setSelectedTable(null);
    setData([]);
    setColumns([]);
    setCurrentPage(1);
    setSortConfig({ column: null, direction: 'ASC' });
    setTableFilters({});
  };

  useEffect(() => {
    if (view === 'explorer' && selectedConnId && selectedTable) {
      fetchTableData(selectedSchema, selectedTable);
    }
  }, [currentPage, pageSize, sortConfig, tableFilters, selectedTable, selectedConnId]);

  useEffect(() => {
    if (view === 'explorer' && selectedConnId) fetchSchemas();
  }, [view, selectedConnId]);

  const fetchSchemas = async () => {
    const res = await apiFetch('/api/db/schemas');
    if (res.ok) setSchemas(await res.json());
    fetchDbRoles();
  };

  const fetchDbRoles = async () => {
    if (!selectedConnId) return;
    const res = await apiFetch('/api/db/roles');
    if (res.ok) setDbRoles(await res.json());
  };

  const setRoleEndDate = async (name, date) => {
    const res = await apiFetch(`/api/db/roles/${encodeURIComponent(name)}/valid-until`, { method: 'PUT', body: JSON.stringify({ date: date || null }) });
    if (res.ok) fetchDbRoles(); else alert((await res.json()).error);
  };

  // schema name -> number of (non-superuser) login roles that can use it
  const schemaUserCount = {};
  dbRoles.forEach(r => r.schemas.forEach(s => { schemaUserCount[s] = (schemaUserCount[s] || 0) + 1; }));

  useEffect(() => {
    if (view === 'users' && selectedConnId) fetchDbRoles();
  }, [view, selectedConnId]);

  const fetchTablesForSchema = async (schema, force = false) => {
    if (!force && schemaTables[schema]) return;
    setLoading(true);
    const res = await apiFetch(`/api/db/tables?schema=${schema}`);
    if (res.ok) {
      const result = await res.json();
      setSchemaTables(prev => ({ ...prev, [schema]: result }));
    }
    setLoading(false);
  };

  const fetchTableData = async (schema, tableName) => {
    setLoading(true);
    setSelectedSchema(schema);
    setSelectedTable(tableName);
    setTableTab('data');
    setTableProps(null);

    const params = new URLSearchParams({
      schema,
      page: currentPage,
      limit: pageSize,
      sortBy: sortConfig.column || '',
      sortOrder: sortConfig.direction,
      filters: JSON.stringify(tableFilters)
    });

    const res = await apiFetch(`/api/db/tables/${tableName}?${params.toString()}`);
    if (res.ok) {
      const { rows, totalCount: total } = await res.json();
      let cols = rows.length > 0 ? Object.keys(rows[0]) : columns;
      
      if (cols.length === 0) {
        const colRes = await apiFetch('/api/db/query', { method: 'POST', body: JSON.stringify({ query: `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${tableName}' ORDER BY ordinal_position` }) });
        if (colRes.ok) {
           const colData = await colRes.json();
           cols = colData.map(c => c.column_name);
        }
      }
      setData(rows);
      setColumns(cols);
      setTotalCount(total);
    }
    const pres = await apiFetch(`/api/db/tables/${tableName}/properties?schema=${schema}`);
    if (pres.ok) setTableProps(await pres.json());
    setLoading(false);
  };

  const formatBytes = (n) => {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  };

  const handleSort = (column) => {
    setSortConfig(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'ASC' ? 'DESC' : 'ASC'
    }));
    setCurrentPage(1);
  };

  const handleFilterChange = (column, value) => {
    setTableFilters(prev => ({ ...prev, [column]: value }));
    setCurrentPage(1);
  };

  const executeMgmtAction = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { action, sourceName, sourceSchema, targetSchema, newName } = mgmtForm;
    
    let url, body;
    if (action === 'copy_schema') {
      url = `/api/db/schemas/${sourceSchema}/copy`;
      body = { targetSchema };
    } else {
      url = `/api/db/tables/${sourceName}/action`;
      body = { action, schema: sourceSchema, targetSchema, newName };
    }

    const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
    if (res.ok) {
      setMgmtAction(null);
      fetchSchemas();
      if (sourceSchema) fetchTablesForSchema(sourceSchema, true);
      if (targetSchema) fetchTablesForSchema(targetSchema, true);
      setSuccess('Operation successful');
      setTimeout(() => setSuccess(null), 3000);
    } else {
      const err = await res.json();
      setError(err.error);
      setTimeout(() => setError(null), 3000);
    }
    setLoading(false);
  };

  const handleRefresh = () => {
    fetchSchemas();
    if (selectedSchema) {
      fetchTablesForSchema(selectedSchema, true);
    }
    if (selectedTable && selectedSchema) {
      fetchTableData(selectedSchema, selectedTable);
    } else if (sqlQuery && view === 'console') {
      runQuery();
    }
  };

  const runQuery = async () => {
    setLoading(true);
    setSuccess(null);
    setError(null);
    try {
      const res = await apiFetch('/api/db/query', { method: 'POST', body: JSON.stringify({ query: sqlQuery }) });
      const result = await res.json();
      if (res.ok) { 
        setData(result);
        setColumns(result.length > 0 ? Object.keys(result[0]) : []);
        setSuccess('Command executed successfully');
        setSelectedTable(null); // Clear selected table when running raw query
      } else { 
        setError(result.error); 
      }
    } catch (err) { setError('Network Error'); }
    setLoading(false);
  };

  const createSchema = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch('/api/db/query', { method: 'POST', body: JSON.stringify({ query: `CREATE SCHEMA "${schemaForm.name}"` }) });
    if (res.ok) { 
      alert(`Schema ${schemaForm.name} created`); 
      setIsEditing(null); 
      setSchemaForm({ name: '' }); 
      fetchSchemas(); 
    } else { alert((await res.json()).error); }
    setLoading(false);
  };

  const createTable = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch('/api/db/query', { method: 'POST', body: JSON.stringify({ query: `CREATE TABLE "${selectedSchema}"."${tableForm.name}" (${tableForm.columns})` }) });
    if (res.ok) { 
      alert(`Table ${tableForm.name} created in ${selectedSchema}`); 
      setIsEditing(null); 
      setTableForm({ name: '', columns: 'id SERIAL PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }); 
      fetchTablesForSchema(selectedSchema, true); 
    } else { alert((await res.json()).error); }
    setLoading(false);
  };

  const filteredSchemas = schemas.filter(s => s.schema_name.toLowerCase().includes(schemaFilter.trim().toLowerCase()));
  const groupedSchemas = (() => {
    if (!groupByPrefix) return [{ name: null, items: filteredSchemas }];
    const byPrefix = {};
    filteredSchemas.forEach(s => {
      const p = s.schema_name.slice(0, 3).toLowerCase();
      (byPrefix[p] = byPrefix[p] || []).push(s);
    });
    const groups = [];
    const singles = [];
    Object.entries(byPrefix).forEach(([p, items]) => {
      if (items.length > 1) groups.push({ name: p, items });
      else singles.push(items[0]);
    });
    const out = groups.map(g => g);
    singles.forEach(s => out.push({ name: null, items: [s] }));
    return out.sort((a, b) => (a.name || a.items[0].schema_name).toLowerCase().localeCompare((b.name || b.items[0].schema_name).toLowerCase()));
  })();

  // --- UI COMPONENTS ---

  const Sidebar = () => (
    <aside className="sidebar glass-panel">
      <div className="brand-section">
        <div className="brand-logo"><Database size={24} /></div>
        <div className="brand-text">
          <h1>IvryDB</h1>
          <span className="badge">Premium Admin</span>
        </div>
      </div>
      
      <nav className="sidebar-nav">
        <button className={`nav-link ${view === 'connections' ? 'active' : ''}`} onClick={() => setView('connections')}><Activity size={18} /> Dashboard</button>
        <button className={`nav-link ${view === 'explorer' || view === 'console' ? 'active' : ''}`} disabled={!selectedConnId} onClick={() => setView('explorer')}><Server size={18} /> Explorer</button>
        {appUser === 'admin' && (
          <button className={`nav-link ${view === 'users' ? 'active' : ''}`} onClick={() => { setView('users'); fetchAppUsers(); }}><Users size={18} /> User Access</button>
        )}
        {appUser === 'admin' && (
          <button className={`nav-link ${view === 'backups' ? 'active' : ''}`} onClick={() => setView('backups')}><HardDrive size={18} /> Backups</button>
        )}
      </nav>

      {view === 'explorer' && (
        <div className="mini-explorer">
          <div className="explorer-title">Schemata ({filteredSchemas.length}/{schemas.length})</div>
          <input className="tree-search" value={schemaFilter} onChange={e => setSchemaFilter(e.target.value)} placeholder="Filtrer les schémas..." />
          <label className="tree-group-toggle"><input type="checkbox" checked={groupByPrefix} onChange={e => setGroupByPrefix(e.target.checked)} /> Grouper par préfixe (3 lettres)</label>
          <div className="tree-scroll">
            {groupedSchemas.map(g => {
              const open = !g.name || !!schemaFilter || openGroups.has(g.name);
              return (
              <div key={g.name || '_'} className="tree-group">
                {g.name && (
                  <button className="group-btn" onClick={() => {
                    const next = new Set(openGroups);
                    if (next.has(g.name)) next.delete(g.name); else next.add(g.name);
                    setOpenGroups(next);
                  }}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Layers size={14} /> <span>{g.name}*</span><span className="count-pill">{g.items.length}</span>
                  </button>
                )}
                {open && <div className={g.name ? 'group-items' : ''}>
            {g.items.map(s => (
              <div key={s.schema_name} className="tree-item">
                <button className={`schema-btn ${selectedSchema === s.schema_name ? 'selected' : ''}`} onClick={() => {
                  setSelectedSchema(s.schema_name);
                  const next = new Set(expandedSchemas);
                  if (next.has(s.schema_name)) next.delete(s.schema_name);
                  else { next.add(s.schema_name); fetchTablesForSchema(s.schema_name); }
                  setExpandedSchemas(next);
                }}>
                  {expandedSchemas.has(s.schema_name) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Folder size={14} /> <span>{s.schema_name}</span>
                  <span className="size-label" title={`${s.size_bytes} bytes`}>{formatBytes(s.size_bytes)}</span>
                  <span className="count-badge" title={`${schemaUserCount[s.schema_name] || 0} user(s) can access this schema`}>{schemaUserCount[s.schema_name] || 0}</span>
                  <button className="schema-action-btn" title="Copy Schema" onClick={(e) => {
                    e.stopPropagation();
                    setMgmtForm({ action: 'copy_schema', sourceSchema: s.schema_name, targetSchema: `${s.schema_name}_copy` });
                    setMgmtAction('copy_schema');
                  }}><Layers size={12} /></button>
                </button>
                {expandedSchemas.has(s.schema_name) && (
                  <div className="table-list">
                    {schemaTables[s.schema_name]?.map(t => (
                      <div key={t.table_name} className="table-item-row">
                        <button className={`table-btn ${selectedTable === t.table_name && selectedSchema === s.schema_name ? 'active' : ''}`} onClick={() => fetchTableData(s.schema_name, t.table_name)}>
                          <TableIcon size={12} /> {t.table_name}
                        </button>
                        <div className="table-actions-toolbar">
                          <button onClick={() => { setMgmtForm({ action: 'copy', sourceName: t.table_name, sourceSchema: s.schema_name, targetSchema: s.schema_name, newName: `${t.table_name}_copy` }); setMgmtAction('copy_table'); }} title="Copy"><Layers size={10}/></button>
                          <button onClick={() => { setMgmtForm({ action: 'rename', sourceName: t.table_name, sourceSchema: s.schema_name, newName: t.table_name }); setMgmtAction('rename_table'); }} title="Rename"><Edit3 size={10}/></button>
                          <button onClick={() => { setMgmtForm({ action: 'truncate', sourceName: t.table_name, sourceSchema: s.schema_name }); setMgmtAction('truncate_table'); }} title="Truncate"><RefreshCw size={10}/></button>
                          <button className="text-error" onClick={() => { setMgmtForm({ action: 'delete', sourceName: t.table_name, sourceSchema: s.schema_name }); setMgmtAction('delete_table'); }} title="Delete"><Trash2 size={10}/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
                </div>}
              </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <div className="user-profile">
          <div className="avatar">{appUser?.charAt(0).toUpperCase()}</div>
          <div className="user-info">
            <div className="username">{appUser}</div>
            <div className="status online">Online</div>
          </div>
        </div>
        <button className="logout-btn" onClick={handleLogout}><LogOut size={16} /></button>
      </div>
    </aside>
  );

  // --- VIEWS ---

  if (view === 'login') {
    return (
      <div className="login-viewport bg-luxury">
        <div className="login-container">
          <div className="login-card glass-premium animate-zoom">
            <div className="login-header">
              <div className="logo-glow">
                <Shield size={42} className="text-primary" />
              </div>
              <h1 className="title-gradient">IvryDB Core</h1>
              <p className="subtitle">Secure Database Management Hub</p>
            </div>
            
            <form className="login-form" onSubmit={handleAppLogin}>
              <div className="input-field">
                <label>System Identifier</label>
                <div className="input-wrapper">
                  <Users size={18} className="input-icon" />
                  <input 
                    type="text" 
                    value={appCreds.username} 
                    onChange={e => setAppCreds({...appCreds, username: e.target.value})} 
                    placeholder="Enter username"
                    required
                  />
                </div>
              </div>

              <div className="input-field">
                <label>Access Key</label>
                <div className="input-wrapper">
                  <Shield size={18} className="input-icon" />
                  <input 
                    type="password" 
                    value={appCreds.password} 
                    onChange={e => setAppCreds({...appCreds, password: e.target.value})} 
                    placeholder="Enter password"
                    required
                  />
                </div>
              </div>

              {error && <div className="error-card"><AlertCircle size={16} /> {error}</div>}

              <button className="nexus-btn-primary" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : 'Authenticate Session'}
              </button>
            </form>

            <div className="login-footer">
              <p>v2.1.0 • Build Protected by AES-256</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell bg-mesh">
      <Sidebar />
      
      <main className="main-viewport">
        {view === 'connections' && (
          <div className="content-page animate-fade-in">
             <header className="content-header">
                <div className="header-title">
                  <h2>Active Connections</h2>
                  <p className="text-muted">Manage and monitor your database cluster</p>
                </div>
                <button className="action-btn" onClick={() => { setConnForm({ id: '', name: '', host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', password: '' }); setIsEditing('connection'); }}><Plus size={18} /> New Node</button>
             </header>

             <div className="dashboard-grid">
               {connections.map(c => (
                 <div key={c.id} className="nexus-card glass-panel">
                   <div className="card-top">
                     <div className="conn-indicator"><div className="ping pulse"></div> {c.database}</div>
                     <div className="card-menu">
                        <button onClick={() => { setConnForm(c); setIsEditing('connection'); }}><Edit3 size={14} /></button>
                        <button onClick={() => deleteConnection(c.id)} className="text-error"><Trash2 size={14} /></button>
                     </div>
                   </div>
                   <div className="card-body">
                      <h3>{c.name || 'PostgreSQL Instance'}</h3>
                      <div className="stats">
                        <div className="stat-item"><Cpu size={14} /> <span>{c.host}</span></div>
                        <div className="stat-item"><Layers size={14} /> <span>Port {c.port}</span></div>
                      </div>
                   </div>
                   <button className="card-footer-btn" onClick={() => startExplorer(c)}>Launch Ivry Terminal</button>
                 </div>
               ))}
             </div>
          </div>
        )}

        {view === 'backups' && <Backups apiFetch={apiFetch} connections={connections} />}

        {view === 'users' && (
          <div className="content-page animate-fade-in">
             <header className="content-header">
                <div className="header-title">
                  <h2>User Access Control</h2>
                  <p className="text-muted">{usersTab === 'roles' ? 'PostgreSQL roles and the schemas they can access' : 'Accounts allowed to sign in to this console'}</p>
                </div>
                {usersTab === 'app' && <button className="action-btn" onClick={() => { setUserForm({ username: '', password: '', endDate: '' }); setIsEditing('user'); }}><Plus size={18} /> Create Account</button>}
                {usersTab === 'roles' && (
                  <select className="conn-select" value={selectedConnId || ''} onChange={e => setSelectedConnId(e.target.value || null)}>
                    <option value="">Select a connection…</option>
                    {connections.map(c => <option key={c.id} value={c.id}>{c.name || c.host}</option>)}
                  </select>
                )}
             </header>

             <div className="nav-tabs users-tabs">
               <button className={`tab ${usersTab === 'roles' ? 'active' : ''}`} onClick={() => setUsersTab('roles')}>Database roles</button>
               <button className={`tab ${usersTab === 'app' ? 'active' : ''}`} onClick={() => setUsersTab('app')}>Console accounts</button>
             </div>

             {usersTab === 'roles' && (
               <div className="user-list glass-panel">
                 {!selectedConnId ? <p className="text-muted pad">Select a connection to list its roles.</p> : (
                 <table>
                   <thead><tr><th></th><th>Role</th><th>Schemas</th><th>End date</th><th>Status</th></tr></thead>
                   <tbody>
                     {dbRoles.map(r => {
                       const open = expandedRoles.has(r.name);
                       const until = r.valid_until && r.valid_until !== 'infinity' ? String(r.valid_until).slice(0, 10) : '';
                       const expired = until && until < new Date().toISOString().slice(0, 10);
                       return (
                         <React.Fragment key={r.name}>
                           <tr className="expandable-row" onClick={() => { const n = new Set(expandedRoles); open ? n.delete(r.name) : n.add(r.name); setExpandedRoles(n); }}>
                             <td>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                             <td><div className="user-name-cell">{r.name} {r.superuser && <Shield size={12} className="text-primary" title="Superuser"/>}</div></td>
                             <td>{r.superuser ? 'All' : <span className="count-badge">{r.schemas.length}</span>}</td>
                             <td onClick={e => e.stopPropagation()}>
                               <input type="date" className="date-input" value={until} onChange={e => setRoleEndDate(r.name, e.target.value)} disabled={r.superuser} />
                             </td>
                             <td><span className={`status-pill ${expired ? 'expired' : 'active'}`}>{expired ? 'Expired' : 'Active'}</span></td>
                           </tr>
                           {open && (
                             <tr className="detail-row"><td></td><td colSpan={4}>
                               {r.superuser ? <span className="text-muted">Superuser: full access to every schema</span> :
                                 r.schemas.length ? <div className="chip-list">{r.schemas.map(sc => <span key={sc} className="chip"><Folder size={11} /> {sc}</span>)}</div> :
                                 <span className="text-muted">No schema access</span>}
                             </td></tr>
                           )}
                         </React.Fragment>
                       );
                     })}
                   </tbody>
                 </table>
                 )}
               </div>
             )}

             {usersTab === 'app' && (
             <div className="user-list glass-panel">
                <table>
                  <thead><tr><th>Avatar</th><th>Username</th><th>End date</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {appUsers.map(u => {
                      const expired = u.endDate && u.endDate < new Date().toISOString().slice(0, 10);
                      return (
                      <tr key={u.username}>
                        <td><div className="mini-avatar">{u.username[0].toUpperCase()}</div></td>
                        <td><div className="user-name-cell">{u.username} {u.username === 'admin' && <Shield size={12} className="text-primary"/>}</div></td>
                        <td>{u.endDate || '—'}</td>
                        <td><span className={`status-pill ${expired ? 'expired' : 'active'}`}>{expired ? 'Expired' : 'Active'}</span></td>
                        <td>
                          <div className="row-actions">
                            <button className="row-icon-btn" onClick={() => { setUserForm({ username: u.username, endDate: u.endDate || '', password: '' }); setIsEditing('user'); }}><Edit3 size={14}/></button>
                            {u.username !== 'admin' && <button className="row-icon-btn text-error" onClick={() => deleteAppUser(u.username)}><Trash2 size={14}/></button>}
                          </div>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
             </div>
             )}
          </div>
        )}

        {(view === 'explorer' || view === 'console') && (
          <div className="explorer-view animate-fade-in">
             <header className="top-nav glass-panel">
                <div className="nav-tabs">
                  <button className={`tab ${view === 'explorer' ? 'active' : ''}`} onClick={() => setView('explorer')}>Data Inspect</button>
                  <button className={`tab ${view === 'console' ? 'active' : ''}`} onClick={() => setView('console')}>SQL Terminal</button>
                </div>
                <div className="nav-info">
                  <Server size={14} /> {selectedSchema} / {selectedTable || 'No Selection'}
                </div>
                <div className="nav-actions">
                   <button className="nav-action-btn" onClick={handleRefresh} title="Rafraîchir les données et la structure" disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {loading ? 'Rafraîchissement...' : 'Rafraîchir'}</button>
                   <button className="nav-action-btn" onClick={() => setIsEditing('schema')} title="New Schema"><Plus size={14}/> Schema</button>
                   <button className="nav-action-btn" onClick={() => setIsEditing('table')} title="New Table" disabled={!selectedSchema}><Plus size={14}/> Table</button>
                </div>
             </header>

             <div className="viewport-scroll">
                {view === 'console' && (
                  <div className="console-wrapper glass-panel">
                    <textarea value={sqlQuery} onChange={e => setSqlQuery(e.target.value)} placeholder="ENTER SQL QUERY..." />
                    <div className="console-footer">
                       <div className="status-messages">
                         {success && <div className="status-success animate-fade-in"><CheckCircle2 size={16} /> {success}</div>}
                         {error && <div className="error-card animate-fade-in"><AlertCircle size={16} /> {error}</div>}
                       </div>
                       <button className="run-btn" onClick={runQuery} disabled={loading}><Play size={16} /> Execute</button>
                    </div>
                  </div>
                )}
                
                {view === 'explorer' && selectedTable && (
                  <div className="props-tabs glass-panel">
                    {[['data', 'Données'], ['general', 'Général'], ['columns', 'Colonnes'], ['constraints', 'Contraintes & index'], ['sql', 'SQL']].map(([k, label]) => (
                      <button key={k} className={`props-tab ${tableTab === k ? 'active' : ''}`} onClick={() => setTableTab(k)}>{label}</button>
                    ))}
                  </div>
                )}

                {view === 'explorer' && selectedTable && tableTab !== 'data' && (
                  <div className="grid-wrapper glass-panel props-panel">
                    {!tableProps ? <div className="empty-viewport"><Loader2 className="animate-spin" size={32} /></div> : (
                      <>
                        {tableTab === 'general' && (
                          <dl className="props-list">
                            <dt>Schéma</dt><dd>{selectedSchema}</dd>
                            <dt>Table</dt><dd>{selectedTable}</dd>
                            <dt>Type</dt><dd>{{ r: 'Table', v: 'Vue', m: 'Vue matérialisée', p: 'Table partitionnée', f: 'Table étrangère' }[tableProps.general.relkind] || tableProps.general.relkind}</dd>
                            <dt>Propriétaire</dt><dd>{tableProps.general.owner}</dd>
                            <dt>Lignes (estimation)</dt><dd>{Number(tableProps.general.est_rows) < 0 ? 'n/a (jamais analysée)' : Number(tableProps.general.est_rows).toLocaleString('fr-FR')}</dd>
                            <dt>Taille table</dt><dd>{formatBytes(tableProps.general.table_bytes)}</dd>
                            <dt>Taille totale (index inclus)</dt><dd>{formatBytes(tableProps.general.total_bytes)}</dd>
                            <dt>Commentaire</dt><dd>{tableProps.general.comment || '—'}</dd>
                          </dl>
                        )}
                        {tableTab === 'columns' && (
                          <div className="table-overflow"><table className="nexus-table">
                            <thead><tr><th>#</th><th>Nom</th><th>Type</th><th>Nullable</th><th>Défaut</th><th>Commentaire</th></tr></thead>
                            <tbody>{tableProps.columns.map(c => (
                              <tr key={c.name}><td>{c.position}</td><td>{c.name}</td><td>{c.type}</td><td>{c.nullable ? 'oui' : 'non'}</td><td>{c.default || ''}</td><td>{c.comment || ''}</td></tr>
                            ))}</tbody>
                          </table></div>
                        )}
                        {tableTab === 'constraints' && (
                          <div className="table-overflow">
                            <table className="nexus-table">
                              <thead><tr><th>Contrainte</th><th>Type</th><th>Définition</th></tr></thead>
                              <tbody>{tableProps.constraints.length ? tableProps.constraints.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.type}</td><td>{c.definition}</td></tr>) : <tr><td colSpan={3}>Aucune contrainte</td></tr>}</tbody>
                            </table>
                            <table className="nexus-table" style={{ marginTop: 16 }}>
                              <thead><tr><th>Index</th><th>Définition</th></tr></thead>
                              <tbody>{tableProps.indexes.length ? tableProps.indexes.map(i => <tr key={i.name}><td>{i.name}</td><td>{i.definition}</td></tr>) : <tr><td colSpan={2}>Aucun index</td></tr>}</tbody>
                            </table>
                          </div>
                        )}
                        {tableTab === 'sql' && (
                          <div>
                            <button className="nav-action-btn" onClick={() => navigator.clipboard?.writeText(tableProps.ddl)}>Copier</button>
                            <pre className="ddl-view">{tableProps.ddl}</pre>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {(view !== 'explorer' || !selectedTable || tableTab === 'data') && <div className="grid-wrapper glass-panel">
                  {columns.length > 0 || selectedTable ? (
                    <div className="table-container">
                      <div className="table-overflow">
                        <table className="nexus-table">
                          <thead>
                            <tr>
                              {columns.map(k => (
                                <th key={k} onClick={() => handleSort(k)} style={{ cursor: 'pointer' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {k}
                                    {sortConfig.column === k && (
                                      sortConfig.direction === 'ASC' ? <ChevronDown size={14} /> : <ChevronRight size={14} style={{ transform: 'rotate(-90deg)' }} />
                                    )}
                                  </div>
                                </th>
                              ))}
                            </tr>
                            <tr className="filter-row">
                              {columns.map(k => (
                                <th key={`filter-${k}`}>
                                  <input 
                                    type="text" 
                                    placeholder={`Filter ${k}...`}
                                    value={tableFilters[k] || ''}
                                    onChange={(e) => handleFilterChange(k, e.target.value)}
                                    className="column-filter"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>{data.map((r, i) => <tr key={i}>{columns.map(k => <td key={k}>{r[k]?.toString()}</td>)}</tr>)}</tbody>
                        </table>
                        {data.length === 0 && <div style={{padding: '2rem', textAlign: 'center', opacity: 0.7}}>0 rows match criteria in {selectedTable || 'result'}</div>}
                      </div>

                      {/* Pagination Controls */}
                      {selectedTable && (
                        <div className="pagination-bar">
                          <div className="pagination-info">
                            Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} results
                          </div>
                          <div className="pagination-controls">
                            <button 
                              disabled={currentPage === 1} 
                              onClick={() => setCurrentPage(prev => prev - 1)}
                              className="page-btn"
                            >
                              Previous
                            </button>
                            <span className="current-page">Page {currentPage} of {Math.ceil(totalCount / pageSize)}</span>
                            <button 
                              disabled={currentPage >= Math.ceil(totalCount / pageSize)} 
                              onClick={() => setCurrentPage(prev => prev + 1)}
                              className="page-btn"
                            >
                              Next
                            </button>
                            <select 
                              value={pageSize} 
                              onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }}
                              className="page-size-select"
                            >
                              {[10, 20, 30, 50, 100].map(size => (
                                <option key={size} value={size}>{size} per page</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : <div className="empty-viewport"><Search size={64} /> <p>Search for data in the explorer or run a custom query</p></div>}
                </div>}
             </div>
          </div>
        )}
      </main>

      {/* MODALS */}
      {isEditing && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal glass-premium animate-zoom">
            <div className="modal-header">
              <h3>{isEditing === 'connection' ? 'DB Configuration' : 'User Identity'}</h3>
              <button onClick={() => setIsEditing(null)} className="close-btn"><XCircle size={20} /></button>
            </div>
            
            {isEditing === 'connection' ? (
              <form onSubmit={saveConnection} className="modal-form">
                <div className="form-group"><label>Profile Name</label><input value={connForm.name} onChange={e => setConnForm({...connForm, name: e.target.value})} required /></div>
                <div className="form-row">
                  <div className="form-group"><label>Host</label><input value={connForm.host} onChange={e => {
                    let val = e.target.value.trim();
                    if (val.includes('://')) val = val.split('://')[1];
                    setConnForm({...connForm, host: val});
                  }} placeholder="e.g. db or 10.103.131.162" required /></div>
                  <div className="form-group"><label>Port</label><input type="number" value={connForm.port} onChange={e => setConnForm({...connForm, port: parseInt(e.target.value)})} required /></div>
                </div>
                <div className="form-group"><label>Database</label><input value={connForm.database} onChange={e => setConnForm({...connForm, database: e.target.value})} required /></div>
                <div className="form-row">
                  <div className="form-group"><label>User</label><input value={connForm.user} onChange={e => setConnForm({...connForm, user: e.target.value})} /></div>
                  <div className="form-group"><label>Access Key</label><input type="password" value={connForm.password} onChange={e => setConnForm({...connForm, password: e.target.value})} /></div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn-secondary" onClick={() => testConnection(connForm)}>Test Connectivity</button>
                  <button type="submit" className="btn-primary">Save Profile</button>
                </div>
              </form>
            ) : isEditing === 'user' ? (
              <form onSubmit={saveAppUser} className="modal-form">
                <div className="form-group">
                  <label>System Alias</label>
                  <input 
                    value={userForm.username} 
                    onChange={e => setUserForm({...userForm, username: e.target.value})} 
                    disabled={isEditing === 'user' && appUsers.some(u => u.username === userForm.username)} 
                    required 
                    placeholder="Enter unique username"
                  />
                  {appUsers.some(u => u.username === userForm.username) && <p className="text-muted small">Update password for existing user</p>}
                </div>
                <div className="form-group"><label>Access Key</label><input type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} required={!appUsers.some(u => u.username === userForm.username)} placeholder={appUsers.some(u => u.username === userForm.username) ? 'Leave empty to keep current password' : 'New password'} /></div>
                <div className="form-group"><label>End date</label><input type="date" value={userForm.endDate || ''} onChange={e => setUserForm({...userForm, endDate: e.target.value})} /></div>
                <div className="modal-footer">
                  <button type="submit" className="btn-primary full">Save Identity</button>
                </div>
              </form>
            ) : isEditing === 'schema' ? (
              <form onSubmit={createSchema} className="modal-form">
                <div className="form-group"><label>Schema Name</label><input value={schemaForm.name} onChange={e => setSchemaForm({name: e.target.value})} required placeholder="e.g. staging" /></div>
                <div className="modal-footer">
                  <button type="submit" className="btn-primary full">Create Schema</button>
                </div>
              </form>
            ) : (
              <form onSubmit={createTable} className="modal-form">
                <div className="form-group"><label>Table Name</label><input value={tableForm.name} onChange={e => setTableForm({...tableForm, name: e.target.value})} required placeholder="e.g. customers" /></div>
                <div className="form-group">
                  <label>Column Definitions (SQL Style)</label>
                  <textarea 
                    value={tableForm.columns} 
                    onChange={e => setTableForm({...tableForm, columns: e.target.value})} 
                    required 
                    style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '12px', padding: '12px', color: 'white', minHeight: '100px', fontSize: '0.85rem' }}
                  />
                </div>
                <div className="modal-footer">
                  <button type="submit" className="btn-primary full">Create Table in {selectedSchema}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {mgmtAction && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal glass-premium animate-zoom">
            <div className="modal-header">
              <h3 style={{ textTransform: 'capitalize' }}>{mgmtAction.replace('_', ' ')}</h3>
              <button onClick={() => setMgmtAction(null)} className="close-btn"><XCircle size={20} /></button>
            </div>
            
            <form onSubmit={executeMgmtAction} className="modal-form">
              {mgmtAction === 'copy_schema' && (
                <>
                  <p className="text-muted small">Clone all tables from <strong>{mgmtForm.sourceSchema}</strong> to a new schema.</p>
                  <div className="form-group">
                    <label>New Schema Name</label>
                    <input value={mgmtForm.targetSchema} onChange={e => setMgmtForm({...mgmtForm, targetSchema: e.target.value})} required placeholder="e.g. public_backup" />
                  </div>
                </>
              )}

              {mgmtAction === 'copy_table' && (
                <>
                  <p className="text-muted small">Clone <strong>{mgmtForm.sourceName}</strong> from <strong>{mgmtForm.sourceSchema}</strong>.</p>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Target Schema</label>
                      <select value={mgmtForm.targetSchema} onChange={e => setMgmtForm({...mgmtForm, targetSchema: e.target.value})}>
                        {schemas.map(s => <option key={s.schema_name} value={s.schema_name}>{s.schema_name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>New Table Name</label>
                      <input value={mgmtForm.newName} onChange={e => setMgmtForm({...mgmtForm, newName: e.target.value})} required />
                    </div>
                  </div>
                </>
              )}

              {mgmtAction === 'rename_table' && (
                <div className="form-group">
                  <label>New Name for {mgmtForm.sourceName}</label>
                  <input value={mgmtForm.newName} onChange={e => setMgmtForm({...mgmtForm, newName: e.target.value})} required />
                </div>
              )}

              {(mgmtAction === 'truncate_table' || mgmtAction === 'delete_table') && (
                <div className="warning-box">
                  <AlertCircle size={24} />
                  <p>Are you sure you want to <strong>{mgmtAction.split('_')[0]}</strong> the table <strong>{mgmtForm.sourceName}</strong> in <strong>{mgmtForm.sourceSchema}</strong>? This action cannot be undone.</p>
                </div>
              )}

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setMgmtAction(null)}>Cancel</button>
                <button type="submit" className={`btn-primary ${mgmtAction.includes('delete') || mgmtAction.includes('truncate') ? 'btn-danger' : ''}`} disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" /> : 'Confirm Operation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
