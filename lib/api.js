// API DYNOZ PLAYLIST — satu kod untuk dua tempat:
//   server.js  (Node, dalam komputer — data dalam fail)
//   worker.js  (Cloudflare, online — data dalam D1)
// Guna Request/Response standard web supaya jalan kat kedua-duanya.
//
// ctx = {
//   storage: { label, online, maxBytes?, get(), saveIfRev(baseRev, data),
//              loginBlocked(ip), loginFailed(ip), loginOk(ip) },
//   password: kata laluan app (kosong = tiada log masuk),
//   passwordRequired: true = tolak semua permintaan selagi kata laluan belum diset (untuk online),
//   ip: alamat IP pelawat (untuk had cubaan log masuk),
// }

import { clearCookie, hasSession, makeCookie, passwordOk } from './auth.js';
import { getMeta } from './meta.js';
import { searchMode, searchSongs } from './youtube-search.js';
import { httpError } from './util.js';

const MAX_BODY = 25 * 1024 * 1024;

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export function validate(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.playlists)) return 'Format data tak betul';
  if (data.playlists.length > 10000) return 'Terlalu banyak playlist';
  for (const p of data.playlists) {
    if (!p || typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.url !== 'string') {
      return 'Ada playlist yang tak lengkap (perlu id, title, url)';
    }
  }
  return null;
}

// Tulisan mesti datang dari app ni sendiri, bukan laman web lain.
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function readJSON(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw httpError(413, 'Data terlalu besar');
  const text = await request.text();
  if (text.length > MAX_BODY) throw httpError(413, 'Data terlalu besar');
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, 'JSON rosak');
  }
}

export async function handleApi(request, ctx) {
  try {
    return await route(request, ctx);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return json(status, { ok: false, error: err.expose ? err.message : 'Ralat server' });
  }
}

async function route(request, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const secure = url.protocol === 'https:';
  const { storage } = ctx;
  const locked = Boolean(ctx.password);

  if (path === '/api/health') return json(200, { ok: true, app: 'dynoz-playlist' });

  if (path === '/api/login' && method === 'POST') {
    if (!locked) return json(200, { ok: true });
    if (!sameOrigin(request)) throw httpError(403, 'Permintaan dari laman lain tak dibenarkan');
    const ip = ctx.ip || 'unknown';
    const wait = await storage.loginBlocked(ip);
    if (wait) {
      return json(429, { ok: false, error: `Terlalu banyak cubaan salah. Cuba lagi dalam ${Math.ceil(wait / 60)} minit.` });
    }
    const body = await readJSON(request).catch(() => ({}));
    if (!(await passwordOk(body?.password, ctx.password))) {
      await storage.loginFailed(ip);
      await new Promise((r) => setTimeout(r, 600)); // lambatkan cubaan teka kata laluan
      return json(401, { ok: false, auth: 'login', error: 'Kata laluan salah.' });
    }
    await storage.loginOk(ip);
    return json(200, { ok: true }, { 'set-cookie': await makeCookie(ctx.password, secure) });
  }

  if (path === '/api/logout' && method === 'POST') {
    return json(200, { ok: true }, { 'set-cookie': clearCookie(secure) });
  }

  // Semua laluan lain perlukan log masuk (kalau app dikunci)
  if (ctx.passwordRequired && !locked) {
    return json(503, {
      ok: false,
      auth: 'setup',
      error: 'Kata laluan app belum diset. Jalankan "npx wrangler secret put APP_PASSWORD" dalam folder projek.',
    });
  }
  if (locked && !(await hasSession(request, ctx.password))) {
    return json(401, { ok: false, auth: 'login', error: 'Perlu log masuk.' });
  }

  if (path === '/api/playlists') {
    if (method === 'GET') {
      const { rev, data } = await storage.get();
      return json(200, { ok: true, rev, data, where: storage.label, online: Boolean(storage.online), locked });
    }
    if (method === 'PUT') {
      if (!sameOrigin(request)) throw httpError(403, 'Permintaan dari laman lain tak dibenarkan');
      if (!(request.headers.get('content-type') ?? '').includes('application/json')) throw httpError(415, 'Perlu JSON');
      const body = await readJSON(request);
      const problem = validate(body?.data);
      if (problem) throw httpError(400, problem);
      if (storage.maxBytes && JSON.stringify(body.data).length > storage.maxBytes) {
        throw httpError(413, 'Data dah terlalu besar untuk storan online. Buang beberapa gambar cover yang dimuat naik (guna link gambar je).');
      }
      const result = await storage.saveIfRev(Number(body.baseRev) || 0, body.data);
      if (result.conflict) return json(409, { ok: false, conflict: true, rev: result.rev, data: result.data });
      return json(200, { ok: true, rev: result.rev, savedAt: new Date().toISOString() });
    }
    throw httpError(405, 'Method tak dibenarkan');
  }

  if (path === '/api/search' && method === 'GET') {
    try {
      return json(200, { ok: true, ...(await searchSongs(url.searchParams.get('q'))) });
    } catch (err) {
      console.warn(`Carian lagu gagal: ${err.message}`);
      const error = storage.online && searchMode() === 'web'
        ? 'Carian YouTube dari server online perlukan YouTube API key. Tetapkan dengan "npx wrangler secret put YOUTUBE_API_KEY".'
        : 'Carian YouTube tak berjaya sekarang. Cuba lagi sekejap lagi.';
      return json(200, { ok: false, error });
    }
  }

  if (path === '/api/meta' && method === 'GET') {
    const target = url.searchParams.get('url');
    if (!target) throw httpError(400, 'Perlu ?url=');
    try {
      return json(200, await getMeta(target));
    } catch (err) {
      return json(200, { ok: false, error: err.expose ? err.message : 'Tak dapat ambil info dari link tu' });
    }
  }

  throw httpError(404, 'API tak wujud');
}
