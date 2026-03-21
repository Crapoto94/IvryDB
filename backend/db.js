const { Pool } = require('pg');

const pools = new Map();

const getPool = (config) => {
  const host = config.host?.trim();
  const key = `${config.user}@${host}:${config.port}/${config.database}`;
  if (!pools.has(key)) {
    const pool = new Pool({
      user: config.user,
      host: host,
      database: config.database,
      password: config.password,
      port: config.port,
      // Add a timeout to prevent hanging connections
      connectionTimeoutMillis: 5000,
    });
    pools.set(key, pool);
  }
  return pools.get(key);
};

module.exports = { getPool };
