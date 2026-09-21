// DYNOZ PLAYLIST — server kecil tanpa sebarang package tambahan (versi dalam komputer).
//   * hidang folder public/ (webapp)
//   * simpan playlist dalam data/playlists.json
//   * API (tajuk & cover, cari lagu, log masuk) dikongsi dengan versi online — lihat lib/api.js
//
// Jalan:  node server.js [--open] [--lan]      (port lalai 7070, tukar dengan PORT=xxxx)
// Pilihan:
//   YOUTUBE_API_KEY=xxxx   guna YouTube Data API rasmi untuk carian lagu
//   APP_PASSWORD=xxxx      kunci app dengan kata laluan (berguna untuk mod --lan)

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { handleApi } from './lib/api.js';
import { configureSearch, searchMode } from './lib/youtube-search.js';

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
const PASSWORD = process.env.APP_PASSWORD?.trim() || '';

const MAX_BODY = 30 * 1024 * 1024;
const BACKUP_EVERY = 10 * 60 * 1000;

configureSearch({ apiKey: process.env.YOUTUBE_API_KEY, region: process.env.DYNOZ_REGION });

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
        reject(Object.assign(new Error('Data terlalu besar'), { status: 413 }));
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
      throw Object.assign(new Error('Fail data/playlists.json rosak dan tiada backup yang elok. Semak fail tu.'), { status: 500, expose: true });
    }
  }
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

// Had cubaan log masuk (dalam memori): 10 kali salah dalam 15 minit = tunggu.
const LOGIN_WINDOW = 15 * 60 * 1000;
const loginFails = new Map();
const rateHits = new Map();

const fileStorage = {
  label: DATA_LABEL,
  online: false,

  async get() {
    const data = await readData();
    const rev = Number(data?.rev) || 0;
    currentRev ??= rev;
    if (data) delete data.rev;
    return { rev, data };
  },

  // Simpan hanya kalau tab tu nampak versi terkini. Kalau tak, balas "konflik"
  // dan tab tu akan gabungkan perubahannya dengan data terbaru dulu.
  async saveIfRev(baseRev, data) {
    const result = await serialized(async () => {
      if (currentRev === null) currentRev = Number((await readData())?.rev) || 0;
      if (baseRev !== currentRev) return { conflict: true };
      const next = { ...data, rev: currentRev + 1 };
      await writeData(`${JSON.stringify(next, null, 2)}\n`);
      currentRev = next.rev;
      return { ok: true, rev: next.rev };
    });
    return result.conflict ? { conflict: true, ...(await this.get()) } : result;
  },

  loginBlocked(ip) {
    const f = loginFails.get(ip);
    if (!f || Date.now() - f.first > LOGIN_WINDOW || f.count < 10) return 0;
    return Math.ceil((f.first + LOGIN_WINDOW - Date.now()) / 1000);
  },
  loginFailed(ip) {
    const f = loginFails.get(ip);
    if (!f || Date.now() - f.first > LOGIN_WINDOW) loginFails.set(ip, { count: 1, first: Date.now() });
    else f.count += 1;
  },
  loginOk(ip) {
    loginFails.delete(ip);
  },

  // Had guna am (contoh: carian lagu). Dalam komputer sendiri, longgar je.
  rateLimited(key, limit, windowMs) {
    const hit = rateHits.get(key);
    if (!hit || Date.now() - hit.first > windowMs) {
      rateHits.set(key, { count: 1, first: Date.now() });
      return 0;
    }
    hit.count += 1;
    return hit.count > limit ? Math.ceil((hit.first + windowMs - Date.now()) / 1000) : 0;
  },
};

/* ------------------------------------------------------------------ */
/* Laluan                                                              */
/* ------------------------------------------------------------------ */

const HOP_HEADERS = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length']);

// Tukar permintaan Node ke Request standard, hantar ke lib/api.js, tulis balik Response.
async function serveApi(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined && !HOP_HEADERS.has(key)) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req, MAX_BODY);
  const response = await handleApi(new Request(url, { method: req.method, headers, body }), {
    storage: fileStorage,
    password: PASSWORD,
    passwordRequired: false,
    ip: req.socket.remoteAddress,
  });
  const out = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') out[key] = value;
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
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
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname.startsWith('/api/')) return await serveApi(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method tak dibenarkan');
    return await serveStatic(req, res, pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: status >= 500 ? 'Ralat server' : err.message }));
    } else res.end();
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
    console.log(PASSWORD
      ? '  Nota   : app dikunci dengan APP_PASSWORD.'
      : '  Nota   : sesiapa dalam WiFi yang sama boleh buka & ubah playlist (set APP_PASSWORD untuk kunci).');
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
