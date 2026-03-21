import React, { useState, useEffect } from 'react';
import { Database, Table as TableIcon, Terminal, Search, Play, RefreshCw, AlertCircle, Loader2, LogOut, Layers, Server, ChevronRight, ChevronDown, Folder, Plus, Trash2, CheckCircle2, XCircle, Edit3, ArrowLeft, Users, Shield, Settings, Activity, Cpu } from 'lucide-react';

function App() {
  const [appToken, setAppToken] = useState(localStorage.getItem('app_token'));
  const [appUser, setAppUser] = useState(localStorage.getItem('app_user'));
  const [view, setView] = useState('login'); // 'login', 'connections', 'explorer', 'users'
  const [connections, setConnections] = useState([]);
  const [selectedConnId, setSelectedConnId] = useState(null);
  
  // App Users State
  const [appUsers, setAppUsers] = useState([]);
  
  // Explorer State
  const [schemas, setSchemas] = useState([]);
  const [expandedSchemas, setExpandedSchemas] = useState(new Set(['public']));
  const [schemaTables, setSchemaTables] = useState({});
  const [selectedSchema, setSelectedSchema] = useState('public');
  const [selectedTable, setSelectedTable] = useState(null);
  const [data, setData] = useState([]);
  const [sqlQuery, setSqlQuery] = useState('');
  
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // App Login State
  const [appCreds, setAppCreds] = useState({ username: 'admin', password: '' });

  // Connection/User Form State
  const [isEditing, setIsEditing] = useState(false); // Can be 'connection' or 'user'
  const [connForm, setConnForm] = useState({ id: '', name: '', host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', password: '' });
  const [userForm, setUserForm] = useState({ username: '', password: '' });

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
      setUserForm({ username: '', password: '' }); 
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
    setSelectedTable(null);
    setData([]);
  };

  useEffect(() => {
    if (view === 'explorer' && selectedConnId) fetchSchemas();
  }, [view, selectedConnId]);

  const fetchSchemas = async () => {
    const res = await apiFetch('/api/db/schemas');
    if (res.ok) setSchemas(await res.json());
  };

  const fetchTablesForSchema = async (schema) => {
    if (schemaTables[schema]) return;
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
    const res = await apiFetch(`/api/db/tables/${tableName}?schema=${schema}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  };

  const runQuery = async () => {
    setLoading(true);
    const res = await apiFetch('/api/db/query', { method: 'POST', body: JSON.stringify({ query: sqlQuery }) });
    const result = await res.json();
    if (res.ok) { setData(result); setError(null); }
    else setError(result.error);
    setLoading(false);
  };

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
      </nav>

      {view === 'explorer' && (
        <div className="mini-explorer">
          <div className="explorer-title">Schemata</div>
          <div className="tree-scroll">
            {schemas.map(s => (
              <div key={s.schema_name} className="tree-item">
                <button className={`schema-btn ${selectedSchema === s.schema_name ? 'selected' : ''}`} onClick={() => {
                  const next = new Set(expandedSchemas);
                  if (next.has(s.schema_name)) next.delete(s.schema_name);
                  else { next.add(s.schema_name); fetchTablesForSchema(s.schema_name); }
                  setExpandedSchemas(next);
                }}>
                  {expandedSchemas.has(s.schema_name) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Folder size={14} /> <span>{s.schema_name}</span>
                </button>
                {expandedSchemas.has(s.schema_name) && (
                  <div className="table-list">
                    {schemaTables[s.schema_name]?.map(t => (
                      <button key={t.table_name} className={`table-btn ${selectedTable === t.table_name && selectedSchema === s.schema_name ? 'active' : ''}`} onClick={() => fetchTableData(s.schema_name, t.table_name)}>
                        <TableIcon size={12} /> {t.table_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
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

        {view === 'users' && (
          <div className="content-page animate-fade-in">
             <header className="content-header">
                <div className="header-title">
                  <h2>User Access Control</h2>
                  <p className="text-muted">Manage administrative privileges</p>
                </div>
                <button className="action-btn" onClick={() => { setUserForm({ username: '', password: '' }); setIsEditing('user'); }}><Plus size={18} /> Create Account</button>
             </header>
             
             <div className="user-list glass-panel">
                <table>
                  <thead><tr><th>Avatar</th><th>Username</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {appUsers.map(u => (
                      <tr key={u.username}>
                        <td><div className="mini-avatar">{u.username[0].toUpperCase()}</div></td>
                        <td><div className="user-name-cell">{u.username} {u.username === 'admin' && <Shield size={12} className="text-primary"/>}</div></td>
                        <td>Mar 21, 2026</td>
                        <td><span className="status-pill active">Active</span></td>
                        <td>
                          <div className="row-actions">
                            <button className="row-icon-btn" onClick={() => { setUserForm({ ...u, password: '' }); setIsEditing('user'); }}><Edit3 size={14}/></button>
                            {u.username !== 'admin' && <button className="row-icon-btn text-error" onClick={() => deleteAppUser(u.username)}><Trash2 size={14}/></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
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
             </header>

             <div className="viewport-scroll">
                {view === 'console' && (
                  <div className="console-wrapper glass-panel">
                    <textarea value={sqlQuery} onChange={e => setSqlQuery(e.target.value)} placeholder="ENTER SQL QUERY..." />
                    <button className="run-btn" onClick={runQuery} disabled={loading}><Play size={16} /> Execute</button>
                  </div>
                )}
                
                <div className="grid-wrapper glass-panel">
                  {data.length > 0 ? (
                    <div className="table-overflow">
                      <table className="nexus-table">
                        <thead><tr>{Object.keys(data[0]).map(k => <th key={k}>{k}</th>)}</tr></thead>
                        <tbody>{data.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v?.toString()}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                  ) : <div className="empty-viewport"><Search size={64} /> <p>Search for data in the explorer or run a custom query</p></div>}
                </div>
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
                  <div className="form-group"><label>Host</label><input value={connForm.host} onChange={e => setConnForm({...connForm, host: e.target.value})} required /></div>
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
            ) : (
              <form onSubmit={saveAppUser} className="modal-form">
                <div className="form-group">
                  <label>System Alias</label>
                  <input 
                    value={userForm.username} 
                    onChange={e => setUserForm({...userForm, username: e.target.value})} 
                    disabled={appUsers.some(u => u.username === userForm.username && userForm.password === '')} 
                    required 
                    placeholder="Enter unique username"
                  />
                  {appUsers.some(u => u.username === userForm.username) && <p className="text-muted small">Update password for existing user</p>}
                </div>
                <div className="form-group"><label>Access Key</label><input type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} required placeholder="New password" /></div>
                <div className="modal-footer">
                  <button type="submit" className="btn-primary full">Save Identity</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
