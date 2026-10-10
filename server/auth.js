// Google sign-in (same scheme as our other apps): the page gets an ID token from Google Identity Services,
// we verify it here, keep the user in litemat_app_users and a session in litemat_app_sessions; the browser
// only holds the session secret in an httpOnly cookie.
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'lm_session';
const SESSION_TTL = 30 * 24 * 3600e3;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
// stable user id from Google's `sub` (not the email, which can change)
const userIdOf = sub => 'g' + sha(sub).slice(0, 15);
const secure = () => process.env.NODE_ENV === 'production' || /^https:/i.test(process.env.SITE_URL || '');

function cookie(token, maxAgeMs) {
  const p = [`${SESSION_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure()) p.push('Secure');
  return p.join('; ');
}
function sessionToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

export async function makeAuth(pool) {
  if (!GOOGLE_CLIENT_ID) { console.log('🔑 GOOGLE_CLIENT_ID не задан — вход и «Поделиться» выключены'); return null; }
  const { OAuth2Client } = await import('google-auth-library');
  const google = new OAuth2Client(GOOGLE_CLIENT_ID);
  console.log('🔑 Вход через Google включён');

  const publicUser = u => u && { id: u.id, name: u.name, email: u.email, avatar: u.avatar };

  return {
    clientId: GOOGLE_CLIENT_ID,
    // user for this request (from the session cookie) or null
    async user(req) {
      const t = sessionToken(req);
      if (!t || !/^[0-9a-f]{32}$/.test(t)) return null;
      const [[u]] = await pool.query(`SELECT u.id, u.name, u.email, u.avatar FROM litemat_app_sessions s
        JOIN litemat_app_users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`, [t, Date.now()]);
      return u || null;
    },
    async login(req, res, credential) {
      const ticket = await google.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      const g = ticket.getPayload();
      const now = Date.now(), id = userIdOf(g.sub);
      const name = String(g.name || (g.email || '').split('@')[0] || 'Игрок').slice(0, 255);
      await pool.query(`INSERT INTO litemat_app_users (id, email, name, avatar, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE email = VALUES(email), name = VALUES(name), avatar = VALUES(avatar), last_login_at = VALUES(last_login_at)`,
        [id, g.email || null, name, g.picture || null, now, now]);
      const token = crypto.randomBytes(16).toString('hex');
      await pool.query('INSERT INTO litemat_app_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        [token, id, now, now + SESSION_TTL]);
      pool.query('DELETE FROM litemat_app_sessions WHERE expires_at < ?', [now]).catch(() => {}); // housekeeping
      res.append('Set-Cookie', cookie(token, SESSION_TTL));
      return publicUser({ id, name, email: g.email || null, avatar: g.picture || null });
    },
    async logout(req, res) {
      const t = sessionToken(req);
      if (t) await pool.query('DELETE FROM litemat_app_sessions WHERE token = ?', [t]).catch(() => {});
      res.append('Set-Cookie', cookie('', 0));
    },
    publicUser
  };
}
