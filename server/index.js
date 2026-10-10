// Web server for Render: serves the built viewer (dist/) and the share API.
//   POST  /api/shares?name=…   body = the .litematic bytes → {id, updated}
//         same uploader (IP) + same name + same size → that row is overwritten and keeps its id/link
//   PATCH /api/shares/:id      {name} → rename (only by the uploader)
//   GET   /api/shares/:id      → the .litematic bytes (name in X-Name, URI-encoded)
//   GET  /api/config          → {share, maxBytes}  — the page shows «Поделиться» only when share is true
//   GET  /?s=:id              → the viewer, with the shared model's name in the link-preview tags
// Without a database (see db.js) everything but sharing keeps working.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = +(process.env.PORT || 5231);
const MAX_UPLOAD = 20 * 1024 * 1024;
const ID_RE = /^[0-9a-f]{16}$/;

const db = await connect();
// a row must fit into one packet; keep some room for the rest of the INSERT
const maxBytes = db ? Math.min(MAX_UPLOAD, db.maxPacket - 64 * 1024) : 0;

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy: req.ip is the visitor
app.disable('x-powered-by');

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ share: !!db, maxBytes });
});

// uploads per IP per hour — enough for people, a brake for scripts
const RATE = 30, hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  h.push(now); hits.set(ip, h);
  return h.length > RATE;
}
setInterval(() => { const now = Date.now(); for (const [ip, h] of hits) if (!h.some(t => now - t < 3600e3)) hits.delete(ip); }, 600e3).unref();

const uploaderOf = req => crypto.createHash('sha256').update('litemat:' + req.ip).digest('hex');
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'schematic';

app.post('/api/shares', express.raw({ type: '*/*', limit: MAX_UPLOAD }), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Поделиться сейчас нельзя: нет подключения к базе' });
  const data = req.body;
  if (!Buffer.isBuffer(data) || !data.length) return res.status(400).json({ error: 'Пустой файл' });
  if (data.length > maxBytes) return res.status(413).json({ error: `Файл больше ${(maxBytes / 1048576).toFixed(0)} МБ` });
  if (data[0] !== 0x1f || data[1] !== 0x8b) return res.status(400).json({ error: 'Это не .litematic' });
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Слишком много ссылок подряд, попробуй через час' });
  const name = cleanName(req.query.name), uploader = uploaderOf(req), now = Date.now();
  try {
    const [[own]] = await db.pool.query(
      'SELECT id FROM litemat_app_shares WHERE uploader = ? AND name = ? AND size = ? ORDER BY created_at DESC LIMIT 1',
      [uploader, name, data.length]);
    if (own) {
      await db.pool.query('UPDATE litemat_app_shares SET data = ?, updated_at = ? WHERE id = ?', [data, now, own.id]);
      return res.json({ id: own.id, updated: true });
    }
    const id = crypto.randomBytes(8).toString('hex');
    await db.pool.query('INSERT INTO litemat_app_shares (id, name, size, data, uploader, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, data.length, data, uploader, now]);
    res.json({ id, updated: false });
  } catch (e) {
    console.error('share save:', e.message);
    res.status(500).json({ error: 'Не удалось сохранить' });
  }
});

app.patch('/api/shares/:id', express.json({ limit: '4kb' }), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Нет подключения к базе' });
  if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Нет такой ссылки' });
  try {
    const [r] = await db.pool.query('UPDATE litemat_app_shares SET name = ?, updated_at = ? WHERE id = ? AND uploader = ?',
      [cleanName(req.body?.name), Date.now(), req.params.id, uploaderOf(req)]);
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
    const [[row]] = await db.pool.query('SELECT name, data FROM litemat_app_shares WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Нет такой ссылки' });
    db.pool.query('UPDATE litemat_app_shares SET views = views + 1, last_viewed_at = ? WHERE id = ?', [Date.now(), req.params.id]).catch(() => {});
    // the uploader can overwrite a share, so revalidate (express adds an ETag → 304 when unchanged)
    res.set({ 'Content-Type': 'application/octet-stream', 'X-Name': encodeURIComponent(row.name),
      'Access-Control-Expose-Headers': 'X-Name', 'Cache-Control': 'no-cache' });
    res.send(row.data);
  } catch (e) {
    console.error('share load:', e.message);
    res.status(500).json({ error: 'Не удалось загрузить' });
  }
});

// shared link: same page, but the preview says which build it is
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/', async (req, res, next) => {
  const id = String(req.query.s || '');
  if (!db || !ID_RE.test(id)) return next();
  try {
    const [[row]] = await db.pool.query('SELECT name FROM litemat_app_shares WHERE id = ?', [id]);
    if (!row) return next();
    const title = esc(`${row.name} — Litematica Viewer`);
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
      .replace(/(property="og:title" content=")[^"]*/, `$1${title}`)
      .replace(/(name="twitter:title" content=")[^"]*/, `$1${title}`)
      .replace(/(property="og:url" content=")([^"]*)/, (m, a, url) => `${a}${url}?s=${id}`);
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  } catch { next(); }
});

app.use(express.static(DIST, { index: 'index.html', setHeaders(res, p) {
  // hashed bundles can be cached forever; pages must revalidate
  res.set('Cache-Control', p.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
} }));

app.listen(PORT, () => console.log(`🧱 Litematica Viewer: http://localhost:${PORT}`));
