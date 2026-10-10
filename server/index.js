// Web server for Render: serves the built viewer (dist/), Google sign-in and the share API.
//   GET   /api/config            → {share, maxBytes, googleClientId} — sharing needs both MySQL and GOOGLE_CLIENT_ID
//   POST  /api/auth/google       {credential} → {user}  (sets the session cookie)
//   GET   /api/auth/me           → {user|null};  POST /api/auth/logout
//   POST  /api/shares?name=…     body = the .litematic bytes → {id, updated}   (signed in only)
//         same user + same name + same size → that row is overwritten and keeps its id/link
//   PATCH /api/shares/:id        {name} → rename (owner only)
//   GET   /api/shares/:id        → the bytes; X-Name, X-Author, X-Mine (1 when the viewer owns it)
//   GET   /?s=:id                → the viewer, with the shared model's name in the link-preview tags
// Without a database or a Google client id everything but signing in / sharing keeps working.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './db.js';
import { makeAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = +(process.env.PORT || 5231);
const MAX_UPLOAD = 20 * 1024 * 1024;
const ID_RE = /^[0-9a-f]{16}$/;

const db = await connect();
const auth = db ? await makeAuth(db.pool) : null;
const shareOn = !!(db && auth);
// a row must fit into one packet; keep some room for the rest of the INSERT
const maxBytes = shareOn ? Math.min(MAX_UPLOAD, db.maxPacket - 64 * 1024) : 0;

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy: req.ip is the visitor
app.disable('x-powered-by');

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ share: shareOn, maxBytes, googleClientId: shareOn ? auth.clientId : null });
});

// ─── sign-in ───
app.post('/api/auth/google', express.json({ limit: '16kb' }), async (req, res) => {
  if (!shareOn) return res.status(503).json({ error: 'Вход сейчас недоступен' });
  try { res.json({ user: await auth.login(req, res, String(req.body?.credential || '')) }); }
  catch (e) { console.error('google auth:', e.message); res.status(401).json({ error: 'Google не подтвердил вход, попробуй ещё раз' }); }
});
app.get('/api/auth/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!shareOn) return res.json({ user: null });
  try { res.json({ user: auth.publicUser(await auth.user(req)) || null }); }
  catch (e) { console.error('auth me:', e.message); res.json({ user: null }); }
});
app.post('/api/auth/logout', async (req, res) => {
  if (shareOn) await auth.logout(req, res);
  res.json({ ok: true });
});

// uploads per user per hour — enough for people, a brake for scripts
const RATE = 30, hits = new Map();
function rateLimited(key) {
  const now = Date.now(), h = (hits.get(key) || []).filter(t => now - t < 3600e3);
  h.push(now); hits.set(key, h);
  return h.length > RATE;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (!h.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'schematic';

// ─── shares ───
app.post('/api/shares', express.raw({ type: '*/*', limit: MAX_UPLOAD }), async (req, res) => {
  if (!shareOn) return res.status(503).json({ error: 'Поделиться сейчас нельзя: сервер без базы или входа' });
  try {
    const user = await auth.user(req);
    if (!user) return res.status(401).json({ error: 'Сначала войди через Google' });
    const data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) return res.status(400).json({ error: 'Пустой файл' });
    if (data.length > maxBytes) return res.status(413).json({ error: `Файл больше ${(maxBytes / 1048576).toFixed(0)} МБ` });
    if (data[0] !== 0x1f || data[1] !== 0x8b) return res.status(400).json({ error: 'Это не .litematic' });
    if (rateLimited(user.id)) return res.status(429).json({ error: 'Слишком много ссылок подряд, попробуй через час' });
    const name = cleanName(req.query.name), now = Date.now();
    const [[own]] = await db.pool.query(
      'SELECT id FROM litemat_app_shares WHERE user_id = ? AND name = ? AND size = ? ORDER BY created_at DESC LIMIT 1',
      [user.id, name, data.length]);
    if (own) {
      await db.pool.query('UPDATE litemat_app_shares SET data = ?, updated_at = ? WHERE id = ?', [data, now, own.id]);
      return res.json({ id: own.id, updated: true });
    }
    const id = crypto.randomBytes(8).toString('hex');
    await db.pool.query('INSERT INTO litemat_app_shares (id, name, size, data, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, data.length, data, user.id, now]);
    res.json({ id, updated: false });
  } catch (e) {
    console.error('share save:', e.message);
    res.status(500).json({ error: 'Не удалось сохранить' });
  }
});

app.patch('/api/shares/:id', express.json({ limit: '4kb' }), async (req, res) => {
  if (!shareOn) return res.status(503).json({ error: 'Нет подключения к базе' });
  if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Нет такой ссылки' });
  try {
    const user = await auth.user(req);
    if (!user) return res.status(401).json({ error: 'Войди, чтобы переименовать' });
    const [r] = await db.pool.query('UPDATE litemat_app_shares SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [cleanName(req.body?.name), Date.now(), req.params.id, user.id]);
    if (!r.affectedRows) return res.status(403).json({ error: 'Переименовать может только тот, кто поделился' });
    res.json({ ok: true });
  } catch (e) {
    console.error('share rename:', e.message);
    res.status(500).json({ error: 'Не удалось переименовать' });
  }
});

app.get('/api/shares/:id', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Нет подключения к базе' });
  if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Нет такой ссылки' });
  try {
    const [[row]] = await db.pool.query(`SELECT s.name, s.data, s.user_id, u.name AS author FROM litemat_app_shares s
      LEFT JOIN litemat_app_users u ON u.id = s.user_id WHERE s.id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Нет такой ссылки' });
    const me = auth ? await auth.user(req).catch(() => null) : null;
    db.pool.query('UPDATE litemat_app_shares SET views = views + 1, last_viewed_at = ? WHERE id = ?', [Date.now(), req.params.id]).catch(() => {});
    // the owner can overwrite a share, and X-Mine depends on who asks: always revalidate, never share caches
    res.set({ 'Content-Type': 'application/octet-stream', 'X-Name': encodeURIComponent(row.name),
      'X-Author': encodeURIComponent(row.author || ''), 'X-Mine': me && row.user_id === me.id ? '1' : '0',
      'Access-Control-Expose-Headers': 'X-Name, X-Author, X-Mine', 'Cache-Control': 'private, no-cache', 'Vary': 'Cookie' });
    res.send(row.data);
  } catch (e) {
    console.error('share load:', e.message);
    res.status(500).json({ error: 'Не удалось загрузить' });
  }
});

// shared link: same page, but the preview says which build it is and who shared it
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/', async (req, res, next) => {
  const id = String(req.query.s || '');
  if (!db || !ID_RE.test(id)) return next();
  try {
    const [[row]] = await db.pool.query(`SELECT s.name, u.name AS author FROM litemat_app_shares s
      LEFT JOIN litemat_app_users u ON u.id = s.user_id WHERE s.id = ?`, [id]);
    if (!row) return next();
    const title = esc(`${row.name} — Litematica Viewer`);
    const desc = esc(row.author ? `Постройка от ${row.author}. Открой и покрути в 3D прямо в браузере.` : 'Открой и покрути постройку в 3D прямо в браузере.');
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
      .replace(/(property="og:title" content=")[^"]*/, `$1${title}`)
      .replace(/(name="twitter:title" content=")[^"]*/, `$1${title}`)
      .replace(/(property="og:description" content=")[^"]*/, `$1${desc}`)
      .replace(/(name="twitter:description" content=")[^"]*/, `$1${desc}`)
      .replace(/(property="og:url" content=")([^"]*)/, (m, a, url) => `${a}${url}?s=${id}`);
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  } catch { next(); }
});

app.use(express.static(DIST, { index: 'index.html', setHeaders(res, p) {
  // hashed bundles can be cached forever; pages must revalidate
  res.set('Cache-Control', p.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
} }));

app.listen(PORT, () => console.log(`🧱 Litematica Viewer: http://localhost:${PORT}`));
