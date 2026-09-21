// DYNOZ PLAYLIST versi online — Cloudflare Workers + D1.
//   * fail dalam public/ dihidang terus oleh Cloudflare (lihat wrangler.toml)
//   * /api/* dikendali oleh lib/api.js, sama macam server.js dalam komputer
//   * data disimpan dalam pangkalan data D1 (satu baris JSON + nombor versi)
//
// Rahsia (set sekali, tak masuk GitHub):
//   npx wrangler secret put APP_PASSWORD      ← wajib: kata laluan untuk buka app
//   npx wrangler secret put YOUTUBE_API_KEY   ← digalakkan: carian lagu rasmi

import { handleApi } from './lib/api.js';
import { configureSearch } from './lib/youtube-search.js';

const LOGIN_WINDOW = 15 * 60 * 1000;
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS login_fail (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS rate_hits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, first_at INTEGER NOT NULL)',
];
let schemaReady = null;

function d1Storage(db) {
  // D1 tak benarkan CREATE TABLE melalui batch()/prepare() — guna exec().
  const ready = () => (schemaReady ??= (async () => {
    for (const sql of SCHEMA) await db.exec(sql);
  })().catch((err) => {
    schemaReady = null;
    throw err;
  }));

  return {
    label: 'Cloudflare D1',
    online: true,
    maxBytes: 1_900_000, // had saiz satu baris D1 lebih kurang 2 MB

    async get() {
      await ready();
      const row = await db.prepare('SELECT rev, data FROM store WHERE id = 1').first();
      return row ? { rev: row.rev, data: JSON.parse(row.data) } : { rev: 0, data: null };
    },

    // Tulis hanya kalau versi dalam D1 masih sama dengan yang tab tu nampak (elak tertimpa).
    async saveIfRev(baseRev, data) {
      await ready();
      const { rev: _drop, ...clean } = data;
      const json = JSON.stringify(clean);
      const now = new Date().toISOString();
      const result = baseRev === 0
        ? await db.prepare('INSERT INTO store (id, rev, data, updated_at) VALUES (1, 1, ?1, ?2) ON CONFLICT(id) DO NOTHING').bind(json, now).run()
        : await db.prepare('UPDATE store SET rev = rev + 1, data = ?1, updated_at = ?2 WHERE id = 1 AND rev = ?3').bind(json, now, baseRev).run();
      if (result.meta.changes === 1) return { ok: true, rev: baseRev + 1 };
      return { conflict: true, ...(await this.get()) };
    },

    async loginBlocked(ip) {
      await ready();
      const row = await db.prepare('SELECT count, first_at FROM login_fail WHERE ip = ?1').bind(ip).first();
      if (!row || Date.now() - row.first_at > LOGIN_WINDOW || row.count < 10) return 0;
      return Math.ceil((row.first_at + LOGIN_WINDOW - Date.now()) / 1000);
    },
    async loginFailed(ip) {
      await ready();
      const now = Date.now();
      await db.prepare(`
        INSERT INTO login_fail (ip, count, first_at) VALUES (?1, 1, ?2)
        ON CONFLICT(ip) DO UPDATE SET
          count = CASE WHEN ?2 - first_at > ?3 THEN 1 ELSE count + 1 END,
          first_at = CASE WHEN ?2 - first_at > ?3 THEN ?2 ELSE first_at END`).bind(ip, now, LOGIN_WINDOW).run();
    },
    async loginOk(ip) {
      await ready();
      await db.prepare('DELETE FROM login_fail WHERE ip = ?1').bind(ip).run();
    },

    // Had guna am (contoh: carian lagu) — pulangkan saat yang perlu ditunggu, 0 kalau masih boleh.
    async rateLimited(key, limit, windowMs) {
      await ready();
      const now = Date.now();
      await db.prepare(`
        INSERT INTO rate_hits (key, count, first_at) VALUES (?1, 1, ?2)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE WHEN ?2 - first_at > ?3 THEN 1 ELSE count + 1 END,
          first_at = CASE WHEN ?2 - first_at > ?3 THEN ?2 ELSE first_at END`).bind(key, now, windowMs).run();
      const row = await db.prepare('SELECT count, first_at FROM rate_hits WHERE key = ?1').bind(key).first();
      if (!row || row.count <= limit) return 0;
      return Math.ceil((row.first_at + windowMs - now) / 1000);
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    configureSearch({ apiKey: env.YOUTUBE_API_KEY, region: env.DYNOZ_REGION });
    // DYNOZ_OPEN="yes" (wrangler.toml) = terbuka kepada sesiapa yang ada link, tiada log masuk.
    const open = String(env.DYNOZ_OPEN ?? '').toLowerCase() === 'yes';
    return handleApi(request, {
      storage: d1Storage(env.DB),
      password: open ? '' : env.APP_PASSWORD?.trim() || '',
      passwordRequired: !open,
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
    });
  },
};
