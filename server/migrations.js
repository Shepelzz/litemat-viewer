// Schema changes, applied once each, in this order (see migrate() in db.js). Never edit an applied one —
// add a new entry instead. Table names must start with `litemat_app_`.
export const MIGRATIONS = [
  {
    id: '001_create_litemat_app_shares',
    // one row per shared schematic (id was a content hash here; since 002 it's random — see index.js)
    sql: `CREATE TABLE IF NOT EXISTS litemat_app_shares (
      id CHAR(16) NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      size INT UNSIGNED NOT NULL,
      data LONGBLOB NOT NULL,
      views INT UNSIGNED NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      last_viewed_at BIGINT NULL
    ) DEFAULT CHARSET=utf8mb4`
  },
  {
    id: '002_litemat_app_shares_owner',
    // who uploaded (sha256 of the IP, never the IP itself) — the same uploader re-sharing a file with the same
    // name and size overwrites their row, so the link stays the same; also lets them rename it
    sql: [
      'ALTER TABLE litemat_app_shares ADD COLUMN uploader CHAR(64) NULL, ADD COLUMN updated_at BIGINT NULL',
      'CREATE INDEX litemat_app_shares_owner ON litemat_app_shares (uploader, name, size)'
    ]
  },
  {
    id: '003_litemat_app_users',
    // Google sign-in: shares belong to a user from now on (uploader/IP from 002 is no longer used)
    sql: [
      `CREATE TABLE IF NOT EXISTS litemat_app_users (
        id CHAR(16) NOT NULL PRIMARY KEY,
        email VARCHAR(255) NULL,
        name VARCHAR(255) NOT NULL,
        avatar VARCHAR(512) NULL,
        created_at BIGINT NOT NULL,
        last_login_at BIGINT NOT NULL
      ) DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS litemat_app_sessions (
        token CHAR(32) NOT NULL PRIMARY KEY,
        user_id CHAR(16) NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        INDEX litemat_app_sessions_user (user_id)
      ) DEFAULT CHARSET=utf8mb4`,
      'ALTER TABLE litemat_app_shares ADD COLUMN user_id CHAR(16) NULL',
      'CREATE INDEX litemat_app_shares_user ON litemat_app_shares (user_id, name, size)'
    ]
  }
];
