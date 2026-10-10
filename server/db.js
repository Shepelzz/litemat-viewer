// MySQL for shared links. Same connection variables as our other apps on Render:
//   DATABASE_URL=mysql://user:pass@host:3306/db   (or DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME)
//   DB_SSL=true — TLS (Aiven, PlanetScale…);  DB_POOL=5 — pool size
// No variables or no connection → sharing is simply off; the viewer itself never needs the database.
// Every table this app owns is prefixed `litemat_app_` (the database may be shared with other apps).
import { MIGRATIONS } from './migrations.js';

const DB_ENV = ['DATABASE_URL', 'MYSQL_URL', 'DB_HOST', 'MYSQLHOST'];

function config() {
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL;
  let cfg;
  if (url) {
    const u = new URL(url);
    cfg = { host: u.hostname, port: u.port ? +u.port : 3306,
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, '') };
  } else {
    cfg = { host: process.env.DB_HOST || process.env.MYSQLHOST,
      port: +(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
      user: process.env.DB_USER || process.env.MYSQLUSER,
      password: process.env.DB_PASSWORD || process.env.DB_PASS || process.env.MYSQLPASSWORD || '',
      database: process.env.DB_NAME || process.env.DB_DATABASE || process.env.MYSQLDATABASE };
  }
  const ssl = process.env.DB_SSL;
  if (ssl && ssl !== 'false' && ssl !== '0') cfg.ssl = { rejectUnauthorized: false };
  return cfg;
}

// returns null when sharing has to stay off (no config, or the database can't be reached / migrated)
export async function connect() {
  if (!DB_ENV.some(k => process.env[k])) {
    console.log('🗄  MySQL не настроен (нет DATABASE_URL / DB_HOST) — «Поделиться» выключено');
    return null;
  }
  const mysql = (await import('mysql2/promise')).default;
  const cfg = config();
  const pool = mysql.createPool({
    ...cfg, waitForConnections: true,
    connectionLimit: +(process.env.DB_POOL || 5), maxIdle: +(process.env.DB_POOL || 5),
    idleTimeout: 60000, enableKeepAlive: true, charset: 'utf8mb4_general_ci'
  });
  try {
    await migrate(pool);
    const [[{ packet }]] = await pool.query('SELECT @@max_allowed_packet AS packet');
    console.log(`🗄  MySQL подключён: ${cfg.host}/${cfg.database} (max_allowed_packet ${(packet / 1048576).toFixed(0)} МБ)`);
    return { pool, maxPacket: Number(packet) };
  } catch (e) {
    console.error(`🗄  MySQL недоступен (${cfg.host}/${cfg.database}): ${e.message} — «Поделиться» выключено`);
    await pool.end().catch(() => {});
    return null;
  }
}

// applies migrations that haven't run yet, in order; applied ids live in litemat_app_migrations
async function migrate(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS litemat_app_migrations (
    id VARCHAR(64) NOT NULL PRIMARY KEY, applied_at BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4`);
  const [rows] = await pool.query('SELECT id FROM litemat_app_migrations');
  const done = new Set(rows.map(r => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const sql of [].concat(m.sql)) await pool.query(sql);
    await pool.query('INSERT INTO litemat_app_migrations (id, applied_at) VALUES (?, ?)', [m.id, Date.now()]);
    console.log(`🗄  миграция ${m.id} применена`);
  }
}
