// Tempat simpan data playlist.
//   FileStore    — simpan dalam data/playlists.json melalui server.js (cara utama)
//   BrowserStore — simpan dalam browser (localStorage) kalau tiada server, contoh bila dihos statik
//
// App boleh terbuka dalam beberapa tab (atau PC + phone). Setiap simpanan bawa nombor versi;
// tab yang ketinggalan akan gabungkan perubahannya dengan data terbaru, bukan menimpanya.

const LS_KEY = 'dynoz-playlist:data';
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Gabung tiga hala, ikut playlist dan ikut medan:
 * base = data yang tab ni nampak dulu, local = data tab ni sekarang, remote = data terkini dalam fail.
 * Perubahan tab ni menang untuk medan yang dia ubah; selebihnya ikut data terkini.
 */
export function mergeData(base, local, remote) {
  const before = new Map((base?.playlists ?? []).map((p) => [p.id, p]));
  const mine = new Map((local?.playlists ?? []).map((p) => [p.id, p]));
  const playlists = [];
  const seen = new Set();

  for (const rp of remote?.playlists ?? []) {
    seen.add(rp.id);
    const bp = before.get(rp.id);
    const lp = mine.get(rp.id);
    if (!lp) {
      if (!bp) playlists.push(rp); // ditambah oleh tab lain
      continue; // dipadam oleh tab ni
    }
    if (!bp) {
      playlists.push(lp);
      continue;
    }
    const merged = { ...rp };
    for (const key of new Set([...Object.keys(bp), ...Object.keys(lp)])) {
      if (same(lp[key], bp[key])) continue;
      if (key in lp) merged[key] = lp[key];
      else delete merged[key];
    }
    playlists.push(merged);
  }
  for (const lp of local?.playlists ?? []) {
    if (!seen.has(lp.id) && !before.has(lp.id)) playlists.push(lp); // ditambah oleh tab ni
  }

  // Nombor katalog tak boleh bertembung (dua tab tambah playlist serentak)
  let nextNo = Math.max(Number(local?.nextNo) || 1, Number(remote?.nextNo) || 1);
  const used = new Set();
  for (const p of playlists) {
    if (p.sample) continue;
    if (used.has(p.no)) p.no = nextNo;
    used.add(p.no);
    nextNo = Math.max(nextNo, p.no + 1);
  }
  return { version: 1, nextNo, playlists };
}

export async function openStore() {
  let res;
  try {
    res = await fetch('api/playlists', { cache: 'no-store', headers: { accept: 'application/json' } });
  } catch {
    return new BrowserStore();
  }
  // Hosting statik biasanya balas HTML/404 untuk /api — maksudnya tiada server kita.
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return new BrowserStore();
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Server balas ralat ${res.status}`);
  return new FileStore(body.data, body.rev ?? 0, body.file);
}

class FileStore {
  kind = 'file';
  onStatus = () => {};
  onRemote = null; // (data) => data baru app; dipanggil bila data berubah dari tab lain
  #data;
  #rev;
  #base;
  #pending = null;
  #timer = 0;
  #retryTimer = 0;
  #saving = false;
  #again = false;

  constructor(data, rev, file) {
    this.#data = data;
    this.#rev = rev;
    this.#base = clone(data) ?? { playlists: [] };
    this.file = file ?? 'data/playlists.json';
    const flushNow = () => this.flush({ keepalive: true });
    addEventListener('pagehide', flushNow);
    addEventListener('focus', () => this.refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
      else this.refresh();
    });
  }

  load() {
    return this.#data;
  }

  save(data) {
    this.#pending = data;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), 300);
  }

  async flush({ keepalive = false } = {}) {
    clearTimeout(this.#timer);
    clearTimeout(this.#retryTimer);
    if (!this.#pending) return;
    if (this.#saving) {
      this.#again = true;
      return;
    }
    const data = this.#pending;
    this.#pending = null;
    this.#saving = true;
    const body = JSON.stringify({ baseRev: this.#rev, data });
    try {
      const res = await fetch('api/playlists', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: keepalive && body.length < 60_000,
      });
      const reply = await res.json().catch(() => null);
      if (res.status === 409 && reply?.conflict) {
        // Ada tab lain simpan dulu — gabung, kemudian simpan semula.
        const latest = this.#pending ?? data;
        const merged = mergeData(this.#base, latest, reply.data);
        this.#rev = reply.rev;
        this.#base = clone(reply.data) ?? { playlists: [] };
        this.#pending = this.onRemote?.(merged) ?? merged;
        this.#again = true;
        return;
      }
      if (!res.ok || !reply?.ok) throw new Error(reply?.error ?? `HTTP ${res.status}`);
      this.#rev = reply.rev;
      this.#base = JSON.parse(body).data;
      this.onStatus('saved');
    } catch (err) {
      this.#pending ??= data; // cuba lagi nanti, kecuali dah ada perubahan lebih baru
      this.onStatus('error', err);
      this.#retryTimer = setTimeout(() => this.flush(), 5000);
    } finally {
      this.#saving = false;
      if (this.#again) {
        this.#again = false;
        this.flush();
      }
    }
  }

  // Bila tab ni dibuka semula, ambil perubahan yang dibuat dari tab/peranti lain.
  async refresh() {
    if (this.#pending || this.#saving) return;
    let reply;
    try {
      reply = await (await fetch('api/playlists', { cache: 'no-store' })).json();
    } catch {
      return;
    }
    if (!reply?.ok || !reply.data || reply.rev === this.#rev || this.#pending || this.#saving) return;
    this.#rev = reply.rev;
    this.#base = clone(reply.data);
    this.onRemote?.(reply.data);
  }
}

class BrowserStore {
  kind = 'browser';
  file = null;
  onStatus = () => {};
  onRemote = null;

  constructor() {
    // Tab lain dalam browser yang sama ubah data
    addEventListener('storage', (e) => {
      if (e.key !== LS_KEY || !e.newValue) return;
      try {
        this.onRemote?.(JSON.parse(e.newValue));
      } catch {}
    });
  }

  load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  save(data) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      this.onStatus('saved');
    } catch (err) {
      this.onStatus('error', err);
    }
  }

  flush() {}
}
