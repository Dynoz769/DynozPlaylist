// DYNOZ PLAYLIST — server kecil tanpa sebarang package tambahan.
//   * hidang folder public/ (webapp)
//   * simpan playlist dalam data/playlists.json
//   * ambil tajuk & cover dari link Spotify / YouTube / SoundCloud / Apple Music / Deezer ...
//   * cari lagu di YouTube untuk playlist buatan sendiri (lihat youtube-search.js)
//
// Jalan:  node server.js [--open] [--lan]      (port lalai 7070, tukar dengan PORT=xxxx)
// Pilihan: YOUTUBE_API_KEY=xxxx untuk guna YouTube Data API rasmi bagi carian lagu.

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { parseLink } from './public/js/platforms.js';
import { searchMode, searchSongs } from './youtube-search.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(ROOT, process.env.DYNOZ_DATA_DIR || 'data');
const DATA_FILE = path.join(DATA_DIR, 'playlists.json');
const BACKUP_FILE = path.join(DATA_DIR, 'playlists.backup.json');
const DATA_LABEL = path.relative(ROOT, DATA_FILE).split(path.sep).join('/');

const args = new Set(process.argv.slice(2));
const PORT = Number(process.env.PORT) || 7070;
const LAN = args.has('--lan');
const OPEN = args.has('--open');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAX_BODY = 30 * 1024 * 1024;
const BACKUP_EVERY = 10 * 60 * 1000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------------------ */
/* Pembantu HTTP                                                       */
/* ------------------------------------------------------------------ */

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

function sendJSON(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, 'Data terlalu besar'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// Halang "DNS rebinding": hanya terima permintaan yang memang ditujukan ke komputer ni.
function hostAllowed(hostHeader) {
  if (!hostHeader) return false;
  const name = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', '127.0.0.1', '::1'].includes(name)) return true;
  if (!LAN) return false;
  const me = os.hostname().toLowerCase();
  return name === me || name === `${me}.local` || lanAddresses().includes(name);
}

// Tulisan data mesti datang dari app ni sendiri, bukan laman web lain.
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host = '';
  try {
    host = new URL(origin).host;
  } catch {}
  if (host !== req.headers.host) throw httpError(403, 'Permintaan dari laman lain tak dibenarkan');
}

/* ------------------------------------------------------------------ */
/* Data playlist (fail JSON)                                           */
/* ------------------------------------------------------------------ */

async function readData() {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn('  ! data/playlists.json rosak — cuba guna data/playlists.backup.json');
    try {
      return JSON.parse(await readFile(BACKUP_FILE, 'utf8'));
    } catch {
      throw httpError(500, 'Fail data/playlists.json rosak dan tiada backup yang elok. Semak fail tu.');
    }
  }
}

function validate(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.playlists)) return 'Format data tak betul';
  if (data.playlists.length > 10000) return 'Terlalu banyak playlist';
  for (const p of data.playlists) {
    if (!p || typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.url !== 'string') {
      return 'Ada playlist yang tak lengkap (perlu id, title, url)';
    }
  }
  return null;
}

// OneDrive kadang-kadang kunci fail sekejap masa sync — cuba semula beberapa kali.
async function retry(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
}

let lastBackupAt = 0;
let writeChain = Promise.resolve();
let currentRev = null; // nombor versi data; naik setiap kali disimpan

async function getRev() {
  if (currentRev === null) currentRev = Number((await readData())?.rev) || 0;
  return currentRev;
}

async function writeData(json) {
  await mkdir(DATA_DIR, { recursive: true });
  if (Date.now() - lastBackupAt > BACKUP_EVERY) {
    const exists = await stat(DATA_FILE).then(() => true, () => false);
    if (exists) await retry(() => copyFile(DATA_FILE, BACKUP_FILE)).catch(() => {});
    lastBackupAt = Date.now();
  }
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, json, 'utf8');
  await retry(() => rename(tmp, DATA_FILE));
}

// Satu tulisan pada satu masa, supaya semakan versi + tulis berlaku serentak.
function serialized(fn) {
  const run = writeChain.then(fn);
  writeChain = run.catch(() => {});
  return run;
}

// Simpan hanya kalau tab tu nampak versi terkini. Kalau tak, balas "konflik"
// dan tab tu akan gabungkan perubahannya dengan data terbaru dulu.
function saveIfCurrent(baseRev, data) {
  return serialized(async () => {
    const rev = await getRev();
    if (Number(baseRev) !== rev) return { conflict: true, rev };
    const next = { ...data, rev: rev + 1 };
    await writeData(`${JSON.stringify(next, null, 2)}\n`);
    currentRev = next.rev;
    return { conflict: false, rev: next.rev };
  });
}

/* ------------------------------------------------------------------ */
/* Ambil info playlist (tajuk, cover, pemilik)                          */
/* ------------------------------------------------------------------ */

const metaCache = new Map();

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readLimited(res, limit) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= limit) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// Jangan biar server ni dipakai untuk buka alamat dalam rangkaian rumah.
function assertPublic(url) {
  const h = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isPrivate = h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
    /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === '::1' || /^f[cd]|^fe80/.test(h);
  if (isPrivate) throw httpError(400, 'Link tu menghala ke rangkaian dalaman');
}

async function fetchPage(url) {
  assertPublic(url);
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.8,ms;q=0.6' },
    redirect: 'follow',
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { url: res.url, html: await readLimited(res, 2_000_000) };
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s ?? '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return named[code.toLowerCase()] ?? m;
  });
}

function metaTag(html, key) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, 'i'))?.[0];
  if (!tag) return '';
  const m = tag.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return m ? decodeEntities(m[1] ?? m[2]).trim() : '';
}

const tidy = (s) => String(s ?? '').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

function biggerSpotifyCover(url) {
  return String(url ?? '')
    .replace('ab67706f00000002', 'ab67706f00000003')
    .replace('ab67616d00001e02', 'ab67616d0000b273')
    .replace('mosaic.scdn.co/300/', 'mosaic.scdn.co/640/');
}

async function spotifyMeta(info) {
  const j = await fetchJSON(`https://open.spotify.com/oembed?url=${encodeURIComponent(info.url)}`);
  return { title: j.title, cover: biggerSpotifyCover(j.thumbnail_url), author: '' };
}

async function youtubeMeta(info) {
  const target = info.kind === 'video' ? `https://www.youtube.com/watch?v=${info.id}`
    : info.kind === 'mix' ? info.url.replace('music.youtube.com', 'www.youtube.com')
    : `https://www.youtube.com/playlist?list=${info.id}`;
  const j = await fetchJSON(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`);
  return { title: j.title, cover: j.thumbnail_url, author: j.author_name };
}

async function soundcloudMeta(info) {
  const j = await fetchJSON(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(info.url)}`);
  let title = tidy(j.title);
  const author = tidy(j.author_name);
  if (author && title.endsWith(` by ${author}`)) title = title.slice(0, -(` by ${author}`.length));
  return { title, cover: j.thumbnail_url, author };
}

async function deezerMeta(info) {
  const j = await fetchJSON(`https://api.deezer.com/${info.kind}/${info.id}`);
  if (j.error) throw new Error(j.error.message || 'Deezer error');
  return {
    title: j.title || j.name,
    cover: j.picture_xl || j.cover_xl || j.album?.cover_xl || '',
    author: j.creator?.name || j.artist?.name || '',
  };
}

async function pageMeta(info) {
  const { html } = await fetchPage(info.url);
  let title = metaTag(html, 'og:title') || metaTag(html, 'twitter:title') ||
    decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '');
  let cover = metaTag(html, 'og:image') || metaTag(html, 'twitter:image');
  title = tidy(title);

  if (info.platform === 'apple') {
    title = title
      .replace(/\s+on Apple Music$/i, '')
      .replace(/\s+[-–—]\s+(?:Playlist|Album|Single|EP|Song|Station)\b.*$/i, '')
      .replace(/\s+[-–—]\s+Apple Music$/i, '');
    // Tukar gambar kad sosial 1200x630 ke kulit segi empat 600x600
    if (cover) cover = cover.split('?')[0].replace(/\/\d+x\d+[^/]*$/, '/600x600cc.jpg');
  }
  if (info.platform === 'tidal') title = title.replace(/\s+(?:on|\|)\s+TIDAL$/i, '');
  if (info.platform === 'joox') title = title.replace(/\s*[-|]\s*JOOX.*$/i, '');
  if (info.platform === 'amazon') title = title.replace(/\s+on Amazon Music.*$/i, '');
  if (title === 'YouTube' || title === 'Spotify') title = '';

  if (cover) {
    try {
      cover = new URL(cover, info.url).href;
    } catch {
      cover = '';
    }
  }
  return { title, cover, author: '' };
}

// Buka link pendek (spotify.link, on.soundcloud.com, ...) untuk dapat link penuh.
async function resolveShort(info) {
  assertPublic(info.url);
  const res = await fetch(info.url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(9000),
  });
  const direct = parseLink(res.url);
  if (direct && !direct.short && direct.kind !== 'link') {
    res.body?.cancel().catch(() => {});
    return direct;
  }
  const html = (await readLimited(res, 1_500_000)).replace(/\\\//g, '/');
  const candidates = [
    metaTag(html, 'og:url'),
    ...(html.match(/https?:\/\/(?:open\.spotify\.com|(?:www\.)?deezer\.com|soundcloud\.com|music\.apple\.com|(?:www\.|music\.)?youtube\.com)\/[^\s"'<>\\]+/g) ?? []),
  ];
  for (const c of candidates) {
    const p = parseLink(decodeEntities(c));
    if (p && !p.short && p.kind !== 'link') return p;
  }
  return info;
}

async function getMeta(rawUrl) {
  let info = parseLink(rawUrl);
  if (!info) throw httpError(400, 'Tu bukan link yang sah');
  if (info.short) info = await resolveShort(info).catch(() => info);

  const cached = metaCache.get(info.url);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value;

  const fetchers = {
    spotify: spotifyMeta,
    youtube: youtubeMeta,
    ytmusic: youtubeMeta,
    soundcloud: soundcloudMeta,
    deezer: deezerMeta,
  };
  let meta = {};
  const primary = fetchers[info.platform];
  if (primary && info.kind !== 'link') {
    try {
      meta = await primary(info);
    } catch {
      meta = await pageMeta(info).catch(() => ({}));
    }
  } else if (!info.short) {
    meta = await pageMeta(info).catch(() => ({}));
  }

  const value = {
    ok: true,
    url: info.url,
    platform: info.platform,
    kind: info.kind,
    title: tidy(meta.title),
    cover: meta.cover || '',
    author: tidy(meta.author),
  };
  if (value.title) metaCache.set(info.url, { at: Date.now(), value });
  return value;
}

/* ------------------------------------------------------------------ */
/* Laluan                                                              */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === '/api/health') return sendJSON(res, 200, { ok: true, app: 'dynoz-playlist' });

  if (route === '/api/playlists') {
    if (req.method === 'GET') {
      const data = await readData();
      const rev = Number(data?.rev) || 0;
      currentRev ??= rev;
      return sendJSON(res, 200, { ok: true, file: DATA_LABEL, rev, data });
    }
    if (req.method === 'PUT') {
      checkOrigin(req);
      if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw httpError(415, 'Perlu JSON');
      let body;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY));
      } catch (err) {
        if (err.status) throw err;
        throw httpError(400, 'JSON rosak');
      }
      const problem = validate(body?.data);
      if (problem) throw httpError(400, problem);
      const result = await saveIfCurrent(body.baseRev, body.data);
      if (result.conflict) {
        const latest = await readData();
        return sendJSON(res, 409, { ok: false, conflict: true, rev: Number(latest?.rev) || 0, data: latest });
      }
      return sendJSON(res, 200, { ok: true, rev: result.rev, savedAt: new Date().toISOString() });
    }
    throw httpError(405, 'Method tak dibenarkan');
  }

  if (route === '/api/search' && req.method === 'GET') {
    try {
      return sendJSON(res, 200, { ok: true, ...(await searchSongs(url.searchParams.get('q'))) });
    } catch (err) {
      console.warn(`  ! Carian lagu gagal: ${err.message}`);
      return sendJSON(res, 200, { ok: false, error: 'Carian YouTube tak berjaya sekarang. Cuba lagi sekejap lagi.' });
    }
  }

  if (route === '/api/meta' && req.method === 'GET') {
    const target = url.searchParams.get('url');
    if (!target) throw httpError(400, 'Perlu ?url=');
    try {
      return sendJSON(res, 200, await getMeta(target));
    } catch (err) {
      return sendJSON(res, 200, { ok: false, error: err.expose ? err.message : 'Tak dapat ambil info dari link tu' });
    }
  }

  throw httpError(404, 'API tak wujud');
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, 'Alamat rosak');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Tak dibenarkan');

  let body;
  try {
    body = await readFile(file);
  } catch {
    return sendText(res, 404, 'Tak jumpa');
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    // YouTube perlukan "referrer" untuk embed; jangan tukar ke no-referrer.
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req.headers.host)) return sendText(res, 403, 'Host tak dibenarkan');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method tak dibenarkan');
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendJSON(res, status, { ok: false, error: err.expose ? err.message : 'Ralat server' });
    else res.end();
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  const ours = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.json())
    .then((j) => j.app === 'dynoz-playlist')
    .catch(() => false);
  if (ours) {
    console.log(`\n  DYNOZ PLAYLIST memang dah jalan: http://localhost:${PORT}\n`);
    if (OPEN) openBrowser(`http://localhost:${PORT}`);
    process.exit(0);
  }
  console.error(`\n  Port ${PORT} dah dipakai program lain. Cuba port lain, contoh (cmd):  set PORT=7171 && npm start\n`);
  process.exit(1);
});

server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  const local = `http://localhost:${PORT}`;
  console.log('');
  console.log('  DYNOZ PLAYLIST dah jalan');
  console.log(`  Buka   : ${local}`);
  if (LAN) {
    for (const ip of lanAddresses()) console.log(`  Phone  : http://${ip}:${PORT}   (WiFi yang sama)`);
    console.log('  Nota   : sesiapa dalam WiFi yang sama boleh buka & ubah playlist.');
  }
  console.log(`  Data   : ${DATA_LABEL}`);
  console.log(`  Carian : YouTube ${searchMode() === 'api' ? '(API rasmi)' : '(tanpa API key)'}`);
  console.log('  Tutup tetingkap ni (atau tekan Ctrl+C) untuk berhenti.');
  console.log('');
  if (OPEN) openBrowser(local);
});

process.on('SIGINT', async () => {
  await writeChain;
  process.exit(0);
});
