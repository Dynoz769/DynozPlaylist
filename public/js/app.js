// DYNOZ PLAYLIST — logik UI.
import { PLATFORMS, KIND_LABEL, parseLink, extractLinks, platformName } from './platforms.js';
import { openStore } from './store.js';
import { sampleData } from './seed.js';
import { SongPlayer, YT_STATE, YT_ERRORS } from './player.js';

/* ================================================================== */
/* Utiliti                                                             */
/* ================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cssUrl = (u) => `url("${String(u).replace(/[\\"\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const nowISO = () => new Date().toISOString();
const uid = () => globalThis.crypto?.randomUUID?.() ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const normTag = (t) => String(t ?? '').trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 32);
const tagList = (text) => [...new Set(String(text ?? '').split(',').map(normTag).filter(Boolean))];
const canon = (u) => parseLink(u)?.url ?? String(u ?? '');
const catNo = (p) => `${p.sample ? 'DEMO' : 'DNZ'}-${String(p.no).padStart(3, '0')}`;
const isYtThumb = (src) => /ytimg\.com\/vi(?:_webp)?\/[\w-]+\/(?:hq|sd|)default\.(?:jpg|webp)/.test(src);
const validCover = (src) => /^(?:https?:\/\/|data:image\/)/i.test(src);
const isOwn = (p) => p?.platform === 'dynoz';
const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const ytWatch = (id) => `https://www.youtube.com/watch?v=${id}`;
const trackCount = (p) => (p.tracks.length ? `${p.tracks.length} lagu` : 'Kosong');
const narrow = matchMedia('(max-width: 979px)');
const touchOnly = matchMedia('(hover: none)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function hash(str) {
  let h = 5381;
  for (const ch of String(str)) h = (Math.imul(h, 33) + ch.codePointAt(0)) >>> 0;
  return h;
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clock(sec) {
  const s = Math.round(Number(sec) || 0);
  if (s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function compactViews(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')} bilion tontonan`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} juta tontonan`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} ribu tontonan`;
  return `${n} tontonan`;
}

const dateFmt = new Intl.DateTimeFormat('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' });
function when(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '—';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'baru tadi';
  if (s < 3600) return `${Math.floor(s / 60)} minit lepas`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lepas`;
  if (s < 172800) return 'semalam';
  if (s < 604800) return `${Math.floor(s / 86400)} hari lepas`;
  return dateFmt.format(t);
}

// Lukis semula `container` tanpa hilang fokus papan kekunci (ikut baris `keyAttr` + data-act).
function keepFocus(container, render, keyAttr) {
  const active = document.activeElement;
  const memo = container.contains(active) && active.dataset?.act
    ? { key: active.closest(`[${keyAttr}]`)?.getAttribute(keyAttr), act: active.dataset.act }
    : null;
  render();
  if (!memo) return;
  const row = memo.key ? `[${keyAttr}="${CSS.escape(memo.key)}"] ` : '';
  container.querySelector(`${row}[data-act="${memo.act}"]`)?.focus({ preventScroll: true });
}

/* ================================================================== */
/* Keadaan                                                             */
/* ================================================================== */

const PREFS_KEY = 'dynoz-playlist:prefs';
const THEME_KEY = 'dynoz-playlist:theme';
const RECENT_KEY = 'dynoz-playlist:recent-searches';

const state = {
  data: null,
  store: null,
  view: 'rack', // 'rack' | 'songs'
  query: '',
  filter: 'all', // 'all' | 'fav' | kunci platform
  tag: null,
  sort: 'recent',
  // Apa yang sedang dimainkan:
  //   { kind: 'embed', playlistId }                  — playlist link (Spotify, YouTube, ...)
  //   { kind: 'queue', playlistId, key, order, track } — playlist buatan sendiri, lagu demi lagu
  //   { kind: 'song', track }                        — satu lagu dari carian
  now: null,
  paused: false,
  shuffle: false,
  repeatMode: 'all', // 'all' = ulang playlist, 'one' = ulang lagu ni, 'off' = berhenti bila habis
  expanded: false,
  target: null, // playlist buatan sendiri yang terima lagu bila tekan +
  songs: { q: '', typed: '', status: 'idle', results: [], error: '', req: 0 },
};
const brokenCovers = new Set();
const byId = (id) => (id ? state.data?.playlists.find((p) => p.id === id) ?? null : null);

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    if (['recent', 'played', 'plays', 'az', 'no'].includes(prefs.sort)) state.sort = prefs.sort;
    if (typeof prefs.target === 'string') state.target = prefs.target;
    state.shuffle = Boolean(prefs.shuffle);
    if (['all', 'one', 'off'].includes(prefs.repeatMode)) state.repeatMode = prefs.repeatMode;
    else if (prefs.repeat === false) state.repeatMode = 'off'; // tetapan lama
  } catch {}
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: state.sort, target: state.target, shuffle: state.shuffle, repeatMode: state.repeatMode }));
  } catch {}
}

function cleanTrack(t) {
  if (!t || !/^[\w-]{11}$/.test(t.videoId ?? '')) return null;
  return {
    key: String(t.key || uid()),
    videoId: t.videoId,
    title: String(t.title || 'Tanpa tajuk').slice(0, 200),
    artist: String(t.artist || '').slice(0, 120),
    duration: Math.max(0, Number(t.duration) || 0),
    thumb: typeof t.thumb === 'string' && /^https:\/\//.test(t.thumb) ? t.thumb : ytThumb(t.videoId),
    addedAt: typeof t.addedAt === 'string' ? t.addedAt : nowISO(),
    ...(t.blocked ? { blocked: true } : {}),
  };
}

function cleanPlaylist(p) {
  const own = p.platform === 'dynoz' || Array.isArray(p.tracks);
  const info = own ? null : parseLink(p.url);
  const created = typeof p.createdAt === 'string' ? p.createdAt : nowISO();
  return {
    id: String(p.id || uid()),
    no: Number.isInteger(p.no) && p.no > 0 ? p.no : 0,
    title: String(p.title || '').trim().slice(0, 200) || 'Tanpa tajuk',
    url: own ? '' : info?.url ?? String(p.url ?? ''),
    platform: own ? 'dynoz' : info?.platform ?? 'other',
    kind: own ? 'playlist' : info?.kind ?? 'link',
    cover: typeof p.cover === 'string' && validCover(p.cover) ? p.cover : '',
    author: typeof p.author === 'string' ? p.author : '',
    notes: typeof p.notes === 'string' ? p.notes : '',
    tags: Array.isArray(p.tags) ? [...new Set(p.tags.map(normTag).filter(Boolean))] : [],
    favorite: Boolean(p.favorite),
    plays: Math.max(0, Number(p.plays) || 0),
    lastPlayedAt: typeof p.lastPlayedAt === 'string' ? p.lastPlayedAt : null,
    createdAt: created,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : created,
    ...(own ? { tracks: (p.tracks ?? []).map(cleanTrack).filter(Boolean) } : {}),
    ...(p.sample ? { sample: true } : {}),
  };
}

function normalize(raw) {
  const playlists = (Array.isArray(raw?.playlists) ? raw.playlists : [])
    .filter((p) => p && typeof p === 'object' && (p.url || p.title))
    .map(cleanPlaylist);
  // Nombor katalog tak pernah diguna semula — macam label rekod betul.
  let top = Math.max(0, ...playlists.filter((p) => !p.sample).map((p) => p.no));
  let demoTop = Math.max(0, ...playlists.filter((p) => p.sample).map((p) => p.no));
  for (const p of playlists) if (!p.no) p.no = p.sample ? ++demoTop : ++top;
  return { version: 1, nextNo: Math.max(Number(raw?.nextNo) || 1, top + 1), playlists };
}

function commit({ render = true } = {}) {
  state.store.save(state.data);
  if (render) renderAll();
}

/* ================================================================== */
/* Pemain lagu (YouTube)                                               */
/* ================================================================== */

const songPlayer = new SongPlayer({
  onState(s) {
    if (s === YT_STATE.PLAYING) state.paused = false;
    else if (s === YT_STATE.PAUSED || s === YT_STATE.ENDED) state.paused = true;
    else return;
    syncPlayState();
  },
  onEnded() {
    const kind = state.now?.kind;
    if (!kind || kind === 'embed') return;
    if (state.repeatMode === 'one') {
      // Ulang lagu yang sama
      songPlayer.restart();
      state.paused = false;
      syncPlayState();
      return;
    }
    if (kind === 'queue') step(1, { auto: true });
  },
  onError: (code) => handlePlayerError(code),
});

/* ================================================================== */
/* Mula                                                                */
/* ================================================================== */

init();

async function init() {
  applyTheme(getTheme());
  loadPrefs();
  for (;;) {
    try {
      state.store = await openStore();
      break;
    } catch (err) {
      if (err.auth === 'login') {
        await askLogin();
        continue;
      }
      showFatal(err.message, err.auth === 'setup' ? 'App online belum siap' : undefined);
      return;
    }
  }
  const raw = state.store.load();
  state.data = normalize(raw ?? sampleData());
  if (raw == null) state.store.save(state.data);
  state.store.onStatus = onSaveStatus;
  state.store.onRemote = applyRemote;
  state.store.onAuthLost = (retry) => askLogin({ expired: true }).then(retry);
  bindEvents();
  renderAll();
  // Pintasan app: "Cari lagu" buka terus tab carian
  if (new URLSearchParams(location.search).get('view') === 'songs') setView('songs', { focus: true });
}

/* ---------- Log masuk (app online berkunci dengan kata laluan) ---------- */

let loginWaiters = null;

function askLogin({ expired = false } = {}) {
  const dialog = $('#login');
  if (!loginWaiters) {
    loginWaiters = [];
    $('#login-note').textContent = expired
      ? 'Sesi dah tamat. Masukkan kata laluan sekali lagi.'
      : 'Masukkan kata laluan untuk buka rak playlist ni.';
    $('#login-error').textContent = '';
    if (!dialog.open) dialog.showModal();
    $('#login-password').focus();
  }
  return new Promise((resolve) => loginWaiters.push(resolve));
}

$('#login').addEventListener('cancel', (e) => e.preventDefault()); // Esc tak boleh langkau log masuk
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#login-password');
  const button = $('#login-submit');
  const error = $('#login-error');
  button.disabled = true;
  error.textContent = '';
  try {
    const res = await fetch('api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || 'Tak dapat log masuk. Cuba lagi.');
    input.value = '';
    $('#login').close();
    const waiters = loginWaiters ?? [];
    loginWaiters = null;
    for (const done of waiters) done();
  } catch (err) {
    error.textContent = err instanceof TypeError ? 'Tak dapat sambung ke server. Semak internet.' : err.message;
    input.select();
  } finally {
    button.disabled = false;
  }
});

/* ---------- Pasang app (PWA) ---------- */

let installPrompt = null;
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // kita tunjuk butang sendiri dalam menu
  installPrompt = e;
  $('#menu-install').hidden = false;
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  $('#menu-install').hidden = true;
  toast('App dah dipasang. Buka dari skrin utama lepas ni.');
});

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    $('#menu-install').hidden = outcome === 'accepted';
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  toast(ios
    ? 'Kat iPhone/iPad: tekan butang Kongsi kat bawah Safari, skrol dan pilih "Add to Home Screen".'
    : 'Dalam browser ni: buka menu browser (⋮ atau …) dan pilih "Install app" / "Add to Home screen".',
  { timeout: 9000 });
}

// fetch ke API; kalau sesi tamat, minta log masuk dan cuba sekali lagi.
async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status !== 401 || !state.store?.locked) return res;
  await askLogin({ expired: true });
  return fetch(path, options);
}

async function logout() {
  await state.store.flush?.();
  await fetch('api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}

// Data berubah dari tab / peranti lain (atau digabung selepas konflik).
function applyRemote(data) {
  state.data = normalize(data);
  const p = nowPlaylist();
  if (state.now?.playlistId && !p) {
    closePlayer();
  } else if (state.now?.kind === 'queue') {
    syncQueue(p);
  }
  renderAll();
  return state.data;
}

function showFatal(message, title = 'Tak dapat buka data') {
  $('#main').innerHTML = `<div class="empty"><div class="empty-disc"></div><h2>${esc(title)}</h2><p>${esc(message)}</p></div>`;
}

let saveErrorToast = null;
function onSaveStatus(status, err) {
  if (status === 'error' && !saveErrorToast) {
    const s = state.store;
    const message = err?.status >= 400 && err.status < 500 && err.message ? err.message
      : s.kind !== 'file' ? 'Browser ni tak benarkan simpan data. Eksport backup dari menu supaya tak hilang.'
      : s.online ? 'Tak dapat simpan — semak sambungan internet. App akan cuba simpan lagi.'
      : 'Tak dapat simpan ke fail. Server dah tutup? Jalankan START.bat semula — app akan cuba simpan lagi.';
    saveErrorToast = toast(message, { tone: 'error', timeout: 0 });
  } else if (status === 'saved' && saveErrorToast) {
    saveErrorToast();
    saveErrorToast = null;
    toast('Dah disimpan semula');
  }
}

/* ================================================================== */
/* Tapis & susun rak                                                   */
/* ================================================================== */

function passes(p, words) {
  if (state.filter === 'fav' && !p.favorite) return false;
  if (state.filter !== 'all' && state.filter !== 'fav' && p.platform !== state.filter) return false;
  if (state.tag && !p.tags.includes(state.tag)) return false;
  if (words.length) {
    const songs = isOwn(p) ? p.tracks.map((t) => `${t.title} ${t.artist}`).join(' ') : '';
    const hay = fold([p.title, p.notes, p.author, p.tags.join(' '), platformName(p.platform, p.url), catNo(p), KIND_LABEL[p.kind], songs].join(' '));
    return words.every((w) => hay.includes(w));
  }
  return true;
}

const SORTS = {
  recent: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.no - a.no,
  played: (a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '') || b.createdAt.localeCompare(a.createdAt),
  plays: (a, b) => b.plays - a.plays || (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''),
  az: (a, b) => a.title.localeCompare(b.title, 'ms', { sensitivity: 'base', numeric: true }),
  no: (a, b) => Number(Boolean(a.sample)) - Number(Boolean(b.sample)) || a.no - b.no,
};

function visible() {
  const words = fold(state.query).split(/\s+/).filter(Boolean);
  return state.data.playlists.filter((p) => passes(p, words)).sort(SORTS[state.sort] ?? SORTS.recent);
}

function resetFilters() {
  state.query = '';
  state.filter = 'all';
  state.tag = null;
  if (state.view === 'rack') $('#search').value = '';
}

const ownPlaylists = () =>
  state.data.playlists.filter(isOwn).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

function ensureTarget() {
  if (!isOwn(byId(state.target))) state.target = ownPlaylists()[0]?.id ?? null;
  return byId(state.target);
}

/* ================================================================== */
/* Lukis: rak                                                          */
/* ================================================================== */

function renderAll() {
  renderStats();
  renderFilters();
  renderSampleNote();
  renderGrid();
  renderDeck();
  renderSongs();
  renderMenuInfo();
}

function renderStats() {
  const ps = state.data.playlists;
  const platforms = new Set(ps.map((p) => p.platform)).size;
  const favs = ps.filter((p) => p.favorite).length;
  $('#stats').innerHTML =
    `<span><b>${ps.length}</b>playlist</span><span><b>${platforms}</b>platform</span><span><b>${favs}</b>kegemaran</span>`;
}

function renderFilters() {
  const ps = state.data.playlists;
  const counts = new Map();
  for (const p of ps) counts.set(p.platform, (counts.get(p.platform) ?? 0) + 1);
  const favs = ps.filter((p) => p.favorite).length;
  if (state.filter === 'fav' ? !favs : state.filter !== 'all' && !counts.has(state.filter)) state.filter = 'all';

  const pill = (key, label, count, lead = '') =>
    `<button type="button" class="pill" data-filter="${key}" aria-pressed="${state.filter === key}">${lead}${esc(label)}<span class="count">${count}</span></button>`;
  let html = pill('all', 'Semua', ps.length);
  if (favs) html += pill('fav', 'Kegemaran', favs, icon('star', 'i-sm i-fill'));
  for (const [key, pf] of Object.entries(PLATFORMS)) {
    if (counts.has(key)) html += pill(key, pf.name, counts.get(key), `<span class="dot" style="--pf:${pf.color}"></span>`);
  }
  $('#pills').innerHTML = html;

  const tagCounts = new Map();
  for (const p of ps) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  if (state.tag && !tagCounts.has(state.tag)) state.tag = null;
  const tags = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ms'));
  $('#tabs').innerHTML = tags
    .map(([t, n]) => `<button type="button" class="tab" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">${esc(t)}<span class="count">${n}</span></button>`)
    .join('');
  $('#tabs-wrap').hidden = !tags.length;
  $('#filters').hidden = !ps.length;
}

function renderSampleNote() {
  const samples = state.data.playlists.filter((p) => p.sample).length;
  const own = state.data.playlists.length - samples;
  $('#sample-note').hidden = !samples;
  if (!samples) return;
  $('#sample-text').innerHTML = own
    ? `Kau dah ada <b>${own} playlist sendiri</b>. ${samples} playlist bercop CONTOH masih ada dalam rak — buang bila dah tak perlu.`
    : `Ni <b>${samples} playlist contoh</b> je, supaya kau nampak rupa rak ni. Klik mana-mana untuk dengar, lepas tu tambah playlist kau sendiri.`;
}

const GEN_COLORS = [
  ['#2A2DB8', '#B6FF3B'],
  ['#FF5D73', '#1A1033'],
  ['#0E8F82', '#F1EEFF'],
  ['#FFB23F', '#26135C'],
  ['#1D1F3F', '#7CF3C0'],
  ['#E6E1FF', '#3A2CC8'],
  ['#C73A8E', '#FFE7F3'],
  ['#193B2E', '#F2E394'],
];
const GEN_PATTERNS = ['grooves', 'sun', 'stripes', 'split', 'dots'];

function genCoverHTML(p) {
  const h = hash(`${p.title}|${p.no}`);
  const [c1, c2] = GEN_COLORS[h % GEN_COLORS.length];
  const pattern = GEN_PATTERNS[(h >>> 5) % GEN_PATTERNS.length];
  return `<span class="gen" data-pattern="${pattern}" style="--c1:${c1};--c2:${c2}"><span class="gen-no">${esc(p.no ? catNo(p) : 'BARU')}</span><span class="gen-title">${esc(p.title)}</span></span>`;
}

// Kulit playlist buatan sendiri: mozek 2x2 dari gambar lagu-lagunya.
function mosaicHTML(p) {
  const thumbs = [...new Set(p.tracks.filter((t) => !t.blocked).map((t) => t.thumb))];
  if (!thumbs.length) return '';
  const four = thumbs.length >= 4;
  const imgs = (four ? thumbs.slice(0, 4) : thumbs.slice(0, 1))
    .map((src) => `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`)
    .join('');
  return `<span class="mosaic${four ? '' : ' is-single'}">${imgs}</span>`;
}

function coverHTML(p, { lazy = true } = {}) {
  if (p.cover && !brokenCovers.has(p.cover)) {
    const cls = isYtThumb(p.cover) ? ' class="crop-yt"' : '';
    return `<img src="${esc(p.cover)}" alt=""${cls}${lazy ? ' loading="lazy"' : ''} decoding="async" referrerpolicy="no-referrer">`;
  }
  return (isOwn(p) && mosaicHTML(p)) || genCoverHTML(p);
}

function labelImage(p) {
  if (!p) return '';
  if (p.cover && !brokenCovers.has(p.cover)) return p.cover;
  return isOwn(p) ? p.tracks.find((t) => !t.blocked)?.thumb ?? '' : '';
}
const labelStyle = (src) => (src ? ` style="${esc(`--img:${cssUrl(src)}`)}"` : '');

function cardHTML(p) {
  const pf = PLATFORMS[p.platform] ?? PLATFORMS.other;
  const playing = state.now?.playlistId === p.id;
  const meta = isOwn(p) ? trackCount(p) : platformName(p.platform, p.url);
  return `
<article class="card${playing ? ' is-playing' : ''}" data-id="${esc(p.id)}">
  <button type="button" class="art" data-act="play" aria-label="Mainkan ${esc(p.title)}"${playing ? ' aria-current="true"' : ''}>
    <span class="disc" aria-hidden="true"><span class="disc-label"${labelStyle(labelImage(p))}></span></span>
    <span class="sleeve">
      ${coverHTML(p)}
      ${p.sample ? '<span class="stamp-sleeve" aria-hidden="true">Contoh</span>' : ''}
      ${p.favorite ? `<span class="fav-sticker" aria-hidden="true">${icon('star')}</span>` : ''}
      <span class="now-chip" aria-hidden="true"><i></i><i></i><i></i></span>
    </span>
  </button>
  <div class="card-body">
    <h3 class="card-title" data-act="play" title="${esc(p.title)}">${esc(p.title)}</h3>
    <div class="card-meta">
      <span class="pf" style="--pf:${pf.color}">${esc(meta)}</span>
      <span class="cat">${catNo(p)}</span>
      <button type="button" class="star" data-act="fav" aria-pressed="${p.favorite}" aria-label="${p.favorite ? 'Buang dari kegemaran' : 'Tanda kegemaran'}: ${esc(p.title)}">${icon('star')}</button>
    </div>
  </div>
</article>`;
}

function renderGrid() {
  const grid = $('#grid');
  const list = visible();
  const total = state.data.playlists.length;
  keepFocus(grid, () => {
    grid.innerHTML = list.map(cardHTML).join('');
  }, 'data-id');

  $('#results-head').hidden = !total;
  $('#results-count').textContent = list.length === total ? `${total} playlist` : `${list.length} daripada ${total} playlist`;
  $('#sort').value = state.sort;

  const empty = $('#empty');
  if (!total) {
    empty.innerHTML = `
      <div class="empty-disc"></div>
      <h2>Rak kau masih kosong.</h2>
      <p>Tampal link playlist dari Spotify, YouTube, SoundCloud atau mana-mana platform — atau bina playlist sendiri dengan cari lagu.</p>
      <div class="empty-actions">
        <button type="button" class="btn btn-primary" data-act="add">${icon('plus')}Tambah playlist pertama</button>
        <button type="button" class="btn" data-act="new-own">${icon('list-plus')}Buat playlist sendiri</button>
        <button type="button" class="btn" data-act="load-samples">Tunjuk contoh</button>
      </div>
      <dl class="howto">
        <div><dt>Spotify</dt><dd>Buka playlist → butang ⋯ → Share → Copy link to playlist</dd></div>
        <div><dt>YouTube</dt><dd>Buka playlist → Share → Copy</dd></div>
        <div><dt>SoundCloud</dt><dd>Butang Share → Copy link</dd></div>
      </dl>`;
  } else if (!list.length) {
    const q = state.query.trim();
    empty.innerHTML = `
      <h2>Takde yang padan.</h2>
      <p>${q ? `Tiada playlist untuk “${esc(q)}”` : 'Tiada playlist'} dengan tapisan sekarang.</p>
      <div class="empty-actions">
        <button type="button" class="btn" data-act="reset">Tunjuk semua playlist</button>
        ${q ? `<button type="button" class="btn" data-act="search-songs">${icon('music')}Cari “${esc(q)}” sebagai lagu</button>` : ''}
      </div>`;
  }
  empty.hidden = Boolean(list.length);
}

function renderMenuInfo() {
  const s = state.store;
  const samples = state.data.playlists.filter((p) => p.sample).length;
  $('#menu-samples').hidden = !samples;
  $('#menu-logout').hidden = !s.locked;
  // Sembunyi hanya kalau app memang dah dipasang; kalau tak, tunjuk (prompt browser atau arahan manual)
  $('#menu-install').hidden = installed();
  $('#menu-foot').innerHTML = s.kind !== 'file'
    ? 'Data disimpan dalam browser ni je. Eksport backup selalu supaya tak hilang.'
    : s.online
      ? `Data disimpan online (${esc(s.where)}) — sama kat semua peranti.`
      : `Data disimpan dalam fail <code>${esc(s.where)}</code> dalam folder projek.`;
}

/* ================================================================== */
/* Lukis: cari lagu                                                    */
/* ================================================================== */

const SUGGEST = ['lagu raya', 'lofi', 'phonk', 'jiwang 90an', 'OST anime', 'lagu gaming'];

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((q) => typeof q === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}
function rememberSearch(q) {
  const list = [q, ...loadRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

function renderSongs() {
  if (state.view !== 'songs') return;
  renderTargetBar();
  const box = $('#song-results');
  const s = state.songs;

  if (state.store.kind !== 'file') {
    box.innerHTML = `<div class="songs-idle"><h2>Carian lagu perlukan server app.</h2><p>Buka app guna <b>START.bat</b> (atau <code>npm start</code>) untuk cari lagu dan bina playlist sendiri.</p></div>`;
    return;
  }
  if (!s.q) {
    const recent = loadRecent();
    const chips = (list) => list.map((q) => `<button type="button" class="chip" data-act="song-q" data-q="${esc(q)}">${esc(q)}</button>`).join('');
    box.innerHTML = `
      <div class="songs-idle">
        <h2>Cari lagu, bina playlist sendiri.</h2>
        <p>Taip nama lagu atau artis kat atas. Tekan ${icon('play', 'i-fill i-inline')} untuk dengar, ${icon('plus', 'i-inline')} untuk masukkan dalam playlist. Lagu dimainkan penuh dari YouTube.</p>
        ${recent.length ? `<p class="label">Carian terkini</p><div class="chips">${chips(recent)}</div>` : ''}
        <p class="label">Cuba cari</p>
        <div class="chips">${chips(SUGGEST)}</div>
      </div>`;
    return;
  }
  if (s.status === 'error') {
    box.innerHTML = `
      <div class="songs-idle">
        <h2>Carian tak berjaya.</h2>
        <p>${esc(s.error)}</p>
        <div class="empty-actions"><button type="button" class="btn" data-act="song-retry">${icon('refresh')}Cuba lagi</button></div>
      </div>`;
    return;
  }
  if (s.status === 'loading' && !s.results.length) {
    box.innerHTML = `<p class="results-count">Mencari “${esc(s.q)}”…</p><ol class="songlist">${'<li class="song skeleton"><span class="song-main"><span class="song-thumb"></span><span class="song-text"><span class="sk"></span><span class="sk short"></span></span></span></li>'.repeat(6)}</ol>`;
    return;
  }
  if (!s.results.length) {
    box.innerHTML = `<div class="songs-idle"><h2>Tak jumpa lagu.</h2><p>Tiada hasil untuk “${esc(s.q)}”. Cuba ejaan lain atau tambah nama artis.</p></div>`;
    return;
  }
  const target = byId(state.target);
  const head = s.status === 'loading'
    ? `Mencari “${esc(s.q)}”…`
    : `${s.results.length} lagu untuk “${esc(s.q)}”`;
  keepFocus(box, () => {
    box.innerHTML = `
      <div class="song-head"><p class="results-count">${head}</p><p class="source">Dari YouTube</p></div>
      <ol class="songlist${s.status === 'loading' ? ' is-loading' : ''}">${s.results.map((r) => songRowHTML(r, target)).join('')}</ol>`;
  }, 'data-vid');
}

function songRowHTML(r, target) {
  const inTarget = isOwn(target) && target.tracks.some((t) => t.videoId === r.videoId);
  const playing = currentTrack()?.videoId === r.videoId;
  const blocked = r.embeddable === false;
  const meta = [r.artist, r.views ? compactViews(r.views) : ''].filter(Boolean).join(' · ');
  const note = [blocked ? 'Tak boleh main dalam app — buka di YouTube' : '', r.note].filter(Boolean).join(' · ');
  const addLabel = !target ? 'Masukkan ke playlist baru' : inTarget ? `Buang dari ${target.title}` : `Masukkan ke ${target.title}`;
  return `
<li class="song${playing ? ' is-playing' : ''}${blocked ? ' is-blocked' : ''}" data-vid="${esc(r.videoId)}">
  <button type="button" class="song-main" data-act="song-play" aria-label="${blocked ? 'Buka di YouTube' : 'Main'}: ${esc(r.title)}${r.artist ? `, ${esc(r.artist)}` : ''}">
    <span class="song-thumb">
      <img src="${esc(r.thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      <span class="dur">${r.live ? 'LIVE' : clock(r.duration)}</span>
      <span class="thumb-play">${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : icon(blocked ? 'ext' : 'play', blocked ? '' : 'i-fill')}</span>
    </span>
    <span class="song-text">
      <strong>${esc(r.title)}</strong>
      <small>${r.official ? '<span class="badge">Rasmi</span>' : ''}${esc(meta)}</small>
      ${note ? `<span class="note">${esc(note)}</span>` : ''}
    </span>
  </button>
  <button type="button" class="add-btn" data-act="song-add" aria-pressed="${inTarget}" aria-label="${esc(addLabel)}: ${esc(r.title)}"${blocked ? ' disabled' : ''}>${icon(inTarget ? 'check' : 'plus')}</button>
</li>`;
}

function renderTargetBar() {
  const t = ensureTarget();
  $('#target-bar').innerHTML = t
    ? `<span class="label">Butang + masukkan lagu ke</span>
      <button type="button" class="target-chip" data-act="target-menu" aria-haspopup="true">
        <span class="mini">${coverHTML(t, { lazy: false })}</span>
        <span class="grow"><strong>${esc(t.title)}</strong><small>${trackCount(t)}</small></span>
        ${icon('down')}
      </button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" data-act="target-play"${t.tracks.length ? '' : ' disabled'}>${icon('play', 'i-fill')}Main playlist</button>`
    : `<span class="label">Belum ada playlist buatan sendiri</span>
      <span class="spacer"></span>
      <button type="button" class="btn btn-primary btn-sm" data-act="new-own">${icon('list-plus')}Buat playlist baru</button>`;
}

/* ================================================================== */
/* Lukis: deck (pemain)                                                */
/* ================================================================== */

const REPEAT_LABEL = { all: 'playlist', one: 'lagu ni', off: 'mati' };

const TIPS = {
  spotify: 'Login Spotify dalam browser ni untuk dengar lagu penuh — kalau tak, cuma preview 30 saat.',
  apple: 'Login Apple Music dalam pemain untuk dengar lagu penuh — kalau tak, cuma preview.',
  deezer: 'Login Deezer dalam pemain untuk dengar lagu penuh.',
};

// Pemain "embed" untuk playlist link (Spotify, YouTube, SoundCloud, ...)
function loadPlayer(p) {
  const slot = $('#deck-player');
  const tip = $('#player-tip');
  const info = parseLink(p.url);
  const name = platformName(p.platform, p.url);
  slot.replaceChildren();
  slot.className = 'deck-player';
  tip.hidden = true;

  if (info?.embed) {
    const frame = document.createElement('iframe');
    let src = info.embed.src;
    if (info.platform === 'youtube' || info.platform === 'ytmusic') src += `${src.includes('?') ? '&' : '?'}autoplay=1&rel=0`;
    frame.src = src;
    frame.title = `Pemain ${name}: ${p.title}`;
    frame.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    if (info.embed.ratio) frame.style.aspectRatio = info.embed.ratio;
    else frame.height = String(info.embed.height);
    slot.append(frame);
    if (TIPS[info.platform]) {
      tip.textContent = TIPS[info.platform];
      tip.hidden = false;
    }
  } else {
    const why = info?.short
      ? 'Ni link pendek, jadi app tak tahu playlist mana satu. Edit dan tampal link penuh untuk main terus kat sini.'
      : `${esc(name)} tak bagi main terus dalam app lain.`;
    slot.innerHTML = `<div class="no-embed"><b>Buka kat ${esc(name)} untuk dengar.</b><span>${why}</span></div>`;
  }
}

const tagsHTML = (p) => (p.tags.length
  ? `<div class="deck-tags">${p.tags.map((t) => `<button type="button" class="tag-mini" data-act="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>`
  : '');

const factsHTML = (p) => `
  <dl class="deck-facts">
    <div><dt>Dimainkan</dt><dd>${p.plays} kali</dd></div>
    <div><dt>Terakhir</dt><dd>${when(p.lastPlayedAt)}</dd></div>
    <div><dt>Ditambah</dt><dd>${when(p.createdAt)}</dd></div>
  </dl>`;

const favButton = (p) =>
  `<button type="button" class="btn" data-act="fav" aria-pressed="${p.favorite}">${icon('star')}${p.favorite ? 'Kegemaran' : 'Tanda kegemaran'}</button>`;

function linkInfoHTML(p) {
  const pf = PLATFORMS[p.platform] ?? PLATFORMS.other;
  const name = platformName(p.platform, p.url);
  return `
    <div>
      <div class="deck-kicker">
        <span class="pf" style="--pf:${pf.color}">${esc(name)}</span>
        <span>${esc(KIND_LABEL[p.kind] ?? 'Link')}</span>
        <span>${catNo(p)}</span>
      </div>
      <h2 class="deck-title">${esc(p.title)}</h2>
      ${p.author ? `<p class="deck-author">oleh ${esc(p.author)}</p>` : ''}
    </div>
    ${p.notes ? `<p class="deck-notes">${esc(p.notes)}</p>` : ''}
    ${tagsHTML(p)}
    <div class="deck-actions">
      <a class="btn btn-primary" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Buka di ${esc(p.platform === 'other' ? 'laman asal' : name)}${icon('ext')}</a>
      ${favButton(p)}
      <button type="button" class="btn" data-act="edit">${icon('edit')}Edit</button>
      <button type="button" class="btn" data-act="copy">${icon('copy')}Salin link</button>
      <button type="button" class="btn btn-danger" data-act="delete">${icon('trash')}Padam</button>
    </div>
    ${factsHTML(p)}`;
}

// Link YouTube yang buka semua lagu playlist ni sebagai satu senarai main (maksimum 50 lagu).
function ownLink(p) {
  const ids = p.tracks.filter((t) => !t.blocked).slice(0, 50).map((t) => t.videoId);
  return ids.length ? `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}` : '';
}

function trackListHTML(p) {
  const cur = state.now?.kind === 'queue' && state.now.playlistId === p.id ? state.now.key : null;
  return p.tracks.map((t, i) => {
    const current = t.key === cur;
    return `
<li class="track${current ? ' is-current' : ''}${t.blocked ? ' is-blocked' : ''}" data-key="${esc(t.key)}">
  <button type="button" class="track-main" data-act="track-play" aria-label="Main ${esc(t.title)}"${current ? ' aria-current="true"' : ''}>
    <span class="track-no">${current ? '<span class="eq"><i></i><i></i><i></i></span>' : i + 1}</span>
    <span class="track-thumb"><img src="${esc(t.thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>
    <span class="track-text"><strong>${esc(t.title)}</strong><small>${esc(t.artist)}${t.blocked ? ' · tak boleh main dalam app' : ''}</small></span>
    <span class="track-dur">${clock(t.duration)}</span>
  </button>
  <button type="button" class="icon-btn ghost track-more" data-act="track-menu" aria-label="Pilihan untuk ${esc(t.title)}">${icon('dots', 'i-fill')}</button>
</li>`;
  }).join('');
}

function ownInfoHTML(p) {
  const minutes = Math.round(p.tracks.reduce((sum, t) => sum + t.duration, 0) / 60);
  const link = ownLink(p);
  return `
    <div>
      <div class="deck-kicker">
        <span class="pf" style="--pf:${PLATFORMS.dynoz.color}">${PLATFORMS.dynoz.name}</span>
        <span>${trackCount(p)}${minutes ? ` · ${minutes} min` : ''}</span>
        <span>${catNo(p)}</span>
      </div>
      <h2 class="deck-title">${esc(p.title)}</h2>
    </div>
    ${p.notes ? `<p class="deck-notes">${esc(p.notes)}</p>` : ''}
    ${tagsHTML(p)}
    <div class="deck-actions">
      <button type="button" class="btn btn-primary" data-act="add-songs">${icon('plus')}Tambah lagu</button>
      ${favButton(p)}
      <button type="button" class="btn" data-act="edit">${icon('edit')}Edit</button>
      ${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('ext')}Buka di YouTube</a>` : ''}
      <button type="button" class="btn btn-danger" data-act="delete">${icon('trash')}Padam</button>
    </div>
    ${p.tracks.length ? `<ol class="tracklist" aria-label="Senarai lagu">${trackListHTML(p)}</ol>` : ''}
    ${factsHTML(p)}`;
}

function songInfoHTML(t) {
  const target = ensureTarget();
  const inTarget = isOwn(target) && target.tracks.some((x) => x.videoId === t.videoId);
  const label = inTarget ? `Dalam ${target.title}` : target ? `Masukkan ke ${target.title}` : 'Masukkan ke playlist';
  return `
    <div>
      <div class="deck-kicker">
        <span class="pf" style="--pf:${PLATFORMS.youtube.color}">YouTube</span>
        <span>Lagu</span>
        ${t.duration ? `<span>${clock(t.duration)}</span>` : ''}
      </div>
      <h2 class="deck-title">${esc(t.title)}</h2>
      ${t.artist ? `<p class="deck-author">${esc(t.artist)}</p>` : ''}
    </div>
    ${t.note ? `<p class="player-tip">${esc(t.note)}</p>` : ''}
    <div class="deck-actions">
      <button type="button" class="btn btn-primary btn-clip" data-act="song-add-now" aria-pressed="${inTarget}">${icon(inTarget ? 'check' : 'plus')}<span>${esc(label)}</span></button>
      <a class="btn" href="${esc(ytWatch(t.videoId))}" target="_blank" rel="noopener noreferrer">${icon('ext')}Buka di YouTube</a>
    </div>`;
}

function renderDeck() {
  const now = state.now;
  const p = nowPlaylist();
  const song = now?.kind === 'song' ? now.track : null;
  const open = Boolean(p || song);
  const deck = $('#deck');
  document.body.classList.toggle('has-deck', open);
  document.body.classList.toggle('is-playing', open);
  deck.hidden = !open;
  if (!open) return;

  const yt = now.kind !== 'embed';
  const cur = currentTrack();
  $('#deck-eyebrow').textContent = now.kind === 'queue' ? p.title : 'Sedang dimainkan';
  $('#deck-bar-title').textContent = cur ? `${cur.title}${cur.artist ? ` · ${cur.artist}` : ''}` : p?.title ?? '';
  const label = $('#deck-disc-label');
  const img = cur?.thumb || labelImage(p);
  if (img) label.style.setProperty('--img', cssUrl(img));
  else label.style.removeProperty('--img');

  deck.classList.toggle('is-song', now.kind === 'song');
  deck.classList.toggle('has-ctl', yt && Boolean(cur));
  $('#deck-controls').hidden = !(yt && cur);
  for (const b of $$('.bar-ctl', deck)) b.hidden = !(yt && cur) || (b.dataset.act === 'next' && now.kind === 'song');
  const shuffleBtn = $('#deck-controls [data-act="shuffle"]');
  shuffleBtn.setAttribute('aria-pressed', String(state.shuffle));
  shuffleBtn.setAttribute('aria-label', `Main rawak: ${state.shuffle ? 'hidup' : 'mati'}`);
  const repeatBtn = $('#deck-controls [data-act="repeat"]');
  repeatBtn.setAttribute('aria-pressed', String(state.repeatMode !== 'off'));
  repeatBtn.setAttribute('aria-label', `Ulang: ${REPEAT_LABEL[state.repeatMode]}`);
  repeatBtn.querySelector('use')?.setAttribute('href', state.repeatMode === 'one' ? '#i-repeat-one' : '#i-repeat');
  if (yt) $('#player-tip').hidden = true;

  const info = $('#deck-info');
  keepFocus(info, () => {
    info.innerHTML = p ? (isOwn(p) ? ownInfoHTML(p) : linkInfoHTML(p)) : songInfoHTML(song);
  }, 'data-key');
  $('#deck-body').inert = narrow.matches && !state.expanded;
  syncPlayState();
}

function syncPlayState() {
  const yt = Boolean(state.now) && state.now.kind !== 'embed';
  const paused = yt && state.paused;
  document.body.classList.toggle('is-paused', paused);
  for (const b of $$('[data-act="playpause"]')) {
    b.setAttribute('aria-label', paused ? 'Main' : 'Jeda');
    b.querySelector('use')?.setAttribute('href', paused ? '#i-play' : '#i-pause');
  }
}

/* ================================================================== */
/* Main lagu & playlist                                                */
/* ================================================================== */

function nowPlaylist() {
  return state.now?.playlistId ? byId(state.now.playlistId) : null;
}

function currentTrack() {
  const now = state.now;
  if (now?.kind === 'song') return now.track;
  if (now?.kind !== 'queue') return null;
  return nowPlaylist()?.tracks.find((t) => t.key === now.key) ?? now.track ?? null;
}

// Klik kulit playlist dalam rak
function play(id) {
  const p = byId(id);
  if (!p) return;
  if (state.now?.playlistId !== id) {
    if (isOwn(p)) startQueue(id);
    else playEmbed(p);
  }
  if (narrow.matches) setExpanded(true);
}

function playEmbed(p) {
  songPlayer.destroy();
  state.now = { kind: 'embed', playlistId: p.id };
  state.paused = false;
  p.plays += 1;
  p.lastPlayedAt = nowISO();
  loadPlayer(p);
  commit({ render: false });
  $('#deck').scrollTop = 0;
  renderGrid();
  renderDeck();
  renderSongs();
}

function playableKeys(p) {
  return p.tracks.filter((t) => !t.blocked).map((t) => t.key);
}

function startQueue(playlistId, key = null) {
  const p = byId(playlistId);
  if (!p) return;
  if (state.now?.kind !== 'queue' || state.now.playlistId !== playlistId) {
    p.plays += 1;
    p.lastPlayedAt = nowISO();
    commit({ render: false });
    $('#deck').scrollTop = 0;
  }
  const keys = playableKeys(p);
  let order = state.shuffle ? shuffled(keys) : keys;
  if (key && state.shuffle) order = [key, ...order.filter((k) => k !== key)];
  state.now = { kind: 'queue', playlistId, key: key ?? order[0] ?? null, order };
  playCurrent();
}

function playSong(song) {
  if (state.now?.kind !== 'song') $('#deck').scrollTop = 0;
  state.now = { kind: 'song', track: { ...song, key: `song:${song.videoId}` } };
  playCurrent();
}

async function playCurrent() {
  const now = state.now;
  const slot = $('#deck-player');
  const t = currentTrack();
  if (now.kind === 'queue' && t) now.track = t;
  state.paused = false;
  renderGrid();
  renderDeck();
  renderSongs();

  if (!t) {
    const p = nowPlaylist();
    songPlayer.destroy();
    slot.className = 'deck-player';
    slot.innerHTML = p?.tracks.length
      ? '<div class="no-embed"><b>Semua lagu dalam playlist ni tak boleh dimainkan dalam app.</b><span>Pemilik video tak benarkan ia dimainkan di laman lain. Cuba cari versi lain lagu tu.</span></div>'
      : `<div class="no-embed"><b>Playlist ni masih kosong.</b><span>Cari lagu, lepas tu tekan + untuk isi playlist ni.</span><button type="button" class="btn btn-primary btn-sm" data-act="add-songs">${icon('music')}Cari lagu</button></div>`;
    return;
  }
  slot.className = 'deck-player is-yt';
  try {
    await songPlayer.play(slot, t.videoId);
  } catch (err) {
    toast(err.message, { tone: 'error' });
  }
}

// Lagu seterusnya (dir = 1) atau sebelumnya (dir = -1) dalam playlist buatan sendiri.
function step(dir, { auto = false } = {}) {
  const now = state.now;
  if (now?.kind !== 'queue') return;
  const p = nowPlaylist();
  if (!p) return;
  const oldIndex = now.order.indexOf(now.key);
  const keys = playableKeys(p);
  if (state.shuffle) {
    const kept = now.order.filter((k) => keys.includes(k));
    now.order = [...kept, ...keys.filter((k) => !kept.includes(k))];
  } else {
    now.order = keys;
  }
  const order = now.order;
  if (!order.length) {
    now.key = null;
    playCurrent();
    return;
  }
  let i = order.indexOf(now.key);
  if (i < 0) {
    // Lagu semasa dah dibuang / disekat — sambung dari kedudukan dia tadi
    const at = oldIndex >= 0 ? oldIndex : now.fallbackIndex ?? 0;
    i = dir > 0 ? at - 1 : at;
  }
  let next = i + dir;
  if (next >= order.length) {
    if (auto && state.repeatMode === 'off') {
      state.paused = true;
      syncPlayState();
      toast('Habis — semua lagu dalam playlist ni dah dimainkan.');
      return;
    }
    next = 0;
    if (state.shuffle) now.order = shuffled(order);
  }
  if (next < 0) next = now.order.length - 1;
  now.key = now.order[next];
  delete now.fallbackIndex;
  playCurrent();
}

function prevOrRestart() {
  if (state.now?.kind === 'song' || songPlayer.time() > 4) songPlayer.restart();
  else step(-1);
}

// Kemas kini susunan main bila lagu ditambah / dibuang / disusun semula.
function syncQueue(p) {
  const now = state.now;
  if (!p || now?.kind !== 'queue' || now.playlistId !== p.id) return;
  const oldIndex = now.order.indexOf(now.key);
  const keys = playableKeys(p);
  if (state.shuffle) {
    const kept = now.order.filter((k) => keys.includes(k));
    now.order = [...kept, ...keys.filter((k) => !kept.includes(k))];
  } else {
    now.order = keys;
  }
  if (now.key && !keys.includes(now.key) && oldIndex >= 0) now.fallbackIndex = oldIndex;
  if (!now.key && keys.length) {
    // Playlist tadi kosong dan baru dapat lagu pertama — terus main
    now.key = now.order[0];
    playCurrent();
  }
}

function closePlayer() {
  state.now = null;
  songPlayer.destroy();
  const slot = $('#deck-player');
  slot.replaceChildren();
  slot.className = 'deck-player';
  $('#player-tip').hidden = true;
  setExpanded(false);
  renderGrid();
  renderDeck();
  renderSongs();
}

function handlePlayerError(code) {
  const now = state.now;
  const t = currentTrack();
  if (!now || !t) return;
  const why = YT_ERRORS[code] ?? `ralat ${code}`;
  if (now.kind === 'queue' && [100, 101, 150].includes(code)) {
    const track = nowPlaylist()?.tracks.find((x) => x.key === t.key);
    if (track) {
      track.blocked = true;
      commit({ render: false });
    }
    toast(`Langkau “${t.title}” — ${why}.`);
    setTimeout(() => {
      if (state.now === now) step(1, { auto: true });
    }, 800);
    return;
  }
  state.paused = true;
  syncPlayState();
  toast(`“${t.title}” tak dapat dimainkan — ${why}.`, {
    tone: 'error',
    action: 'Buka di YouTube',
    onAction: () => window.open(ytWatch(t.videoId), '_blank', 'noopener'),
  });
}

function setExpanded(open) {
  state.expanded = Boolean(open) && narrow.matches && Boolean(state.now);
  $('#deck').classList.toggle('is-expanded', state.expanded);
  $('#scrim').hidden = !state.expanded;
  document.documentElement.classList.toggle('lock', state.expanded);
  const toggle = $('#deck-toggle');
  toggle.setAttribute('aria-expanded', String(state.expanded));
  toggle.setAttribute('aria-label', state.expanded ? 'Kecilkan pemain' : 'Besarkan pemain');
  $('#deck-body').inert = narrow.matches && !state.expanded;
}

/* ================================================================== */
/* Lagu dalam playlist buatan sendiri                                  */
/* ================================================================== */

const makeTrack = (s) => ({
  key: uid(),
  videoId: s.videoId,
  title: s.title,
  artist: s.artist ?? '',
  duration: s.duration || 0,
  thumb: s.thumb || ytThumb(s.videoId),
  addedAt: nowISO(),
});

function touch(p) {
  p.updatedAt = nowISO();
  syncQueue(p);
  commit();
}

// Butang + : masukkan (atau buang) lagu dari playlist sasaran.
function toggleInTarget(song) {
  const p = ensureTarget();
  if (!p) {
    openEditor(null, { mode: 'own', pendingSong: song });
    return;
  }
  const at = p.tracks.findIndex((t) => t.videoId === song.videoId);
  if (at >= 0) {
    const [removed] = p.tracks.splice(at, 1);
    touch(p);
    toast(`Dibuang dari ${p.title}`, {
      action: 'Undo',
      onAction() {
        const again = byId(p.id);
        if (!again || again.tracks.some((t) => t.videoId === removed.videoId)) return;
        again.tracks.splice(Math.min(at, again.tracks.length), 0, removed);
        touch(again);
      },
    });
  } else {
    p.tracks.push(makeTrack(song));
    touch(p);
    toast(`Masuk ${p.title} · ${p.tracks.length} lagu`);
  }
}

function moveTrack(p, key, dir) {
  const i = p.tracks.findIndex((t) => t.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.tracks.length) return;
  [p.tracks[i], p.tracks[j]] = [p.tracks[j], p.tracks[i]];
  touch(p);
}

function removeTrack(p, key) {
  const at = p.tracks.findIndex((t) => t.key === key);
  if (at < 0) return;
  const [removed] = p.tracks.splice(at, 1);
  touch(p);
  toast(`“${removed.title}” dibuang`, {
    action: 'Undo',
    onAction() {
      const again = byId(p.id);
      if (!again || again.tracks.some((t) => t.key === removed.key)) return;
      again.tracks.splice(Math.min(at, again.tracks.length), 0, removed);
      touch(again);
    },
  });
}

/* ================================================================== */
/* Tindakan am                                                         */
/* ================================================================== */

function toggleFav(id) {
  const p = byId(id);
  if (!p) return;
  p.favorite = !p.favorite;
  p.updatedAt = nowISO();
  commit();
}

function setTag(tag) {
  state.tag = tag;
  renderFilters();
  renderGrid();
}

function removePlaylists(ids, message) {
  const removed = [];
  state.data.playlists = state.data.playlists.filter((p, index) => {
    if (!ids.includes(p.id)) return true;
    removed.push({ p, index });
    return false;
  });
  if (!removed.length) return;
  if (ids.includes(state.now?.playlistId)) closePlayer();
  commit();
  toast(message, {
    action: 'Undo',
    timeout: 7000,
    onAction() {
      for (const { p, index } of removed) state.data.playlists.splice(Math.min(index, state.data.playlists.length), 0, p);
      commit();
      toast('Dikembalikan');
    },
  });
}

function loadSamples() {
  const have = new Set(state.data.playlists.map((p) => canon(p.url)));
  const fresh = sampleData().playlists.filter((p) => !have.has(canon(p.url))).map((p) => ({ ...p, id: uid() }));
  state.data.playlists.push(...fresh);
  commit();
}

function removeSamples() {
  const ids = state.data.playlists.filter((p) => p.sample).map((p) => p.id);
  if (ids.length) removePlaylists(ids, `${ids.length} playlist contoh dibuang`);
}

function flashCard(id) {
  requestAnimationFrame(() => {
    const el = $(`.card[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  ta.remove();
  return ok;
}

// Gambar kulit rosak → tukar ke kulit auto. Gambar kecil lain (lagu, mozek) → sorok je.
function imageFailed(img) {
  if (img.closest('#f-cover-preview, #bulk-list')) return;
  const sleeve = img.closest('.sleeve, .mini');
  if (!sleeve || img.closest('.mosaic')) {
    img.classList.add('is-broken');
    return;
  }
  const src = img.getAttribute('src');
  brokenCovers.add(src);
  const card = img.closest('.card');
  const p = card ? byId(card.dataset.id) : null;
  const holder = document.createElement('div');
  holder.innerHTML = p ? coverHTML(p) : genCoverHTML({ title: '', no: 0 });
  img.replaceWith(holder.firstElementChild);
  if (p) card.querySelector('.disc-label')?.style.removeProperty('--img');
}

/* ---------- Toast ---------- */

function toast(message, { action, onAction, tone, timeout = 4200 } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast${tone ? ` is-${tone}` : ''}`;
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  };
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action;
    btn.addEventListener('click', () => {
      dismiss();
      onAction?.();
    });
    el.append(btn);
  }
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  if (timeout) timer = setTimeout(dismiss, timeout);
  return dismiss;
}

/* ---------- Popover (menu kecil) ---------- */

function openPopover(menu, anchor, width, align = 'right') {
  // Klik butang yang sama semasa menu terbuka = tutup (light-dismiss dah tutup dia)
  if (menu.anchorEl === anchor && performance.now() - (menu.closedAt ?? 0) < 300) return false;
  menu.anchorEl = anchor;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(width, innerWidth - 16);
  const left = align === 'left' ? r.left : r.right - w;
  menu.style.width = `${w}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(left, innerWidth - w - 8)))}px`;
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.showPopover();
  const h = menu.offsetHeight;
  if (r.bottom + 6 + h > innerHeight - 8 && r.top - 6 - h > 8) menu.style.top = `${Math.round(r.top - 6 - h)}px`;
  return true;
}

function openTargetMenu(anchor) {
  const menu = $('#target-menu');
  menu.innerHTML = `
    <p class="menu-label">Masukkan lagu ke</p>
    ${ownPlaylists().map((p) => `
      <button type="button" class="menu-item menu-pl" data-target="${esc(p.id)}" aria-pressed="${p.id === state.target}">
        <span class="mini">${coverHTML(p, { lazy: false })}</span>
        <span class="grow"><strong>${esc(p.title)}</strong><small>${trackCount(p)}</small></span>
        ${p.id === state.target ? icon('check') : ''}
      </button>`).join('')}
    <hr>
    <button type="button" class="menu-item" data-target="new">${icon('list-plus')}Playlist baru…</button>`;
  openPopover(menu, anchor, 300, 'left');
}

function openTrackMenu(anchor, playlistId, key) {
  const menu = $('#track-menu');
  const p = byId(playlistId);
  const i = p?.tracks.findIndex((t) => t.key === key) ?? -1;
  if (i < 0) return;
  menu.dataset.pid = playlistId;
  menu.dataset.key = key;
  $('[data-track-act="up"]', menu).disabled = i === 0;
  $('[data-track-act="down"]', menu).disabled = i === p.tracks.length - 1;
  $('[data-track-act="play"]', menu).disabled = Boolean(p.tracks[i].blocked);
  $('[data-track-act="open"]', menu).href = ytWatch(p.tracks[i].videoId);
  openPopover(menu, anchor, 240);
}

/* ---------- Tema ---------- */

function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) ?? 'auto';
  } catch {
    return 'auto';
  }
}
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.dataset.theme = theme;
  else delete root.dataset.theme;
  for (const b of $$('[data-theme-set]')) b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme));
}
function setTheme(theme) {
  try {
    if (theme === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {}
  applyTheme(theme);
}

/* ---------- Eksport / import ---------- */

function exportData() {
  const payload = { app: 'dynoz-playlist', exportedAt: nowISO(), ...state.data };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dynoz-playlist-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Backup ${state.data.playlists.length} playlist dimuat turun`);
}

async function importFile(file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    toast('Fail tu bukan backup JSON yang sah.', { tone: 'error' });
    return;
  }
  const list = Array.isArray(raw) ? raw : raw?.playlists;
  if (!Array.isArray(list)) {
    toast('Tak jumpa senarai playlist dalam fail tu.', { tone: 'error' });
    return;
  }
  const have = new Set(state.data.playlists.filter((p) => !isOwn(p)).map((p) => canon(p.url)));
  const haveIds = new Set(state.data.playlists.map((p) => p.id));
  const usedNos = new Set(state.data.playlists.filter((p) => !p.sample).map((p) => p.no));
  let added = 0;
  let skipped = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      skipped += 1;
      continue;
    }
    const own = item.platform === 'dynoz' || Array.isArray(item.tracks);
    const info = own ? null : parseLink(item.url);
    if (own ? haveIds.has(item.id) : !info || have.has(info.url)) {
      skipped += 1;
      continue;
    }
    const p = cleanPlaylist({ ...item, id: own && item.id ? item.id : uid() });
    if (p.sample) {
      p.no = Math.max(0, ...state.data.playlists.filter((x) => x.sample).map((x) => x.no)) + 1;
    } else if (!p.no || usedNos.has(p.no)) {
      p.no = state.data.nextNo;
    }
    if (!p.sample) {
      usedNos.add(p.no);
      state.data.nextNo = Math.max(state.data.nextNo, p.no + 1);
    }
    if (info) have.add(info.url);
    haveIds.add(p.id);
    state.data.playlists.push(p);
    added += 1;
  }
  if (added) {
    resetFilters();
    commit();
  }
  toast(added ? `${added} playlist diimport${skipped ? ` · ${skipped} dilangkau (dah ada / rosak)` : ''}` : 'Semua playlist dalam fail tu dah ada dalam rak.');
}

/* ================================================================== */
/* Paparan: Rak aku / Cari lagu                                        */
/* ================================================================== */

function setView(view, { focus = false } = {}) {
  if (view !== state.view) {
    setExpanded(false);
    state.view = view;
    document.body.dataset.view = view;
    $('#rack-view').hidden = view !== 'rack';
    $('#songs-view').hidden = view !== 'songs';
    for (const b of $$('.viewtab')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    const search = $('#search');
    search.value = view === 'rack' ? state.query : state.songs.typed;
    search.placeholder = view === 'rack' ? 'Cari dalam rak…' : 'Cari lagu atau artis…';
    $('#search-label').textContent = view === 'rack' ? 'Cari playlist dalam rak' : 'Cari lagu di YouTube';
    if (view === 'songs') renderSongs();
    else renderGrid();
    const top = $('.masthead').offsetHeight;
    if (scrollY > top) scrollTo({ top, behavior: 'auto' });
  }
  if (focus && !touchOnly.matches) $('#search').focus();
}

let songTimer = 0;

async function runSongSearch(raw, { force = false } = {}) {
  clearTimeout(songTimer);
  const s = state.songs;
  const q = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (q.length < 2) {
    s.req += 1;
    s.q = '';
    s.results = [];
    s.status = 'idle';
    renderSongs();
    return;
  }
  if (!force && q.toLowerCase() === s.q.toLowerCase() && s.status !== 'error') return;
  if (state.store.kind !== 'file') {
    renderSongs();
    return;
  }
  const req = ++s.req;
  s.q = q;
  s.status = 'loading';
  renderSongs();
  try {
    const res = await api(`api/search?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    if (req !== s.req) return;
    if (!body.ok) throw new Error(body.error || 'Carian tak berjaya.');
    s.results = body.results ?? [];
    s.status = 'ok';
    rememberSearch(q);
  } catch (err) {
    if (req !== s.req) return;
    s.status = 'error';
    const offline = state.store.online ? 'Tak dapat sambung ke server. Semak internet.' : 'Tak dapat sambung ke server app. Pastikan START.bat masih jalan.';
    s.error = err instanceof TypeError || err instanceof SyntaxError ? offline : err.message;
  }
  renderSongs();
}

function searchSongsFor(q) {
  state.songs.typed = q;
  setView('songs');
  $('#search').value = q;
  runSongSearch(q, { force: true });
}

const findResult = (vid) => state.songs.results.find((r) => r.videoId === vid);

/* ================================================================== */
/* Dialog tambah / edit                                                */
/* ================================================================== */

const f = {
  url: $('#f-url'),
  title: $('#f-title'),
  cover: $('#f-cover'),
  tags: $('#f-tags'),
  notes: $('#f-notes'),
  fav: $('#f-fav'),
};
const ed = {
  id: null,
  mode: 'link', // 'link' | 'own'
  pendingSong: null,
  autoTitle: '',
  autoCover: '',
  author: '',
  upload: '',
  metaFor: '',
  metaReq: 0,
  status: 'idle', // idle | loading | ok | partial | fail
  bulk: null,
  bulkRun: null,
};
let urlTimer = 0;
let coverTimer = 0;

function openEditor(id = null, { mode, pendingSong = null } = {}) {
  const p = id ? byId(id) : null;
  ed.id = p?.id ?? null;
  ed.mode = p ? (isOwn(p) ? 'own' : 'link') : mode ?? (state.view === 'songs' ? 'own' : 'link');
  ed.pendingSong = pendingSong;
  ed.autoTitle = '';
  ed.autoCover = '';
  ed.author = p?.author ?? '';
  ed.upload = p?.cover?.startsWith('data:') ? p.cover : '';
  ed.metaFor = p && !isOwn(p) ? canon(p.url) : '';
  ed.status = 'idle';
  ed.bulk = null;

  f.url.value = p?.url ?? '';
  f.title.value = p?.title ?? '';
  f.cover.value = p && !ed.upload ? p.cover : '';
  f.tags.value = p ? p.tags.join(', ') : '';
  f.notes.value = p?.notes ?? '';
  f.fav.checked = Boolean(p?.favorite);
  f.url.removeAttribute('aria-invalid');
  f.title.removeAttribute('aria-invalid');
  $('#f-delete').hidden = !p;
  $('#f-paste').hidden = !navigator.clipboard?.readText;
  $('#editor-mode').hidden = Boolean(p || pendingSong);
  setBulkMode(false);
  applyEditorMode();
  renderUrlHint();
  renderTagSuggest();

  const dialog = $('#editor');
  if (!dialog.open) dialog.showModal();
  (p || ed.mode === 'own' ? f.title : f.url).focus();
}

function applyEditorMode() {
  const own = ed.mode === 'own';
  for (const b of $$('#editor-mode [data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === ed.mode));
  $('#link-field').hidden = own || Boolean(ed.bulk);
  $('#cover-url-field').hidden = own;
  $('#f-title-label').textContent = own ? 'Nama playlist' : 'Tajuk';
  f.title.placeholder = own ? 'Contoh: Lagu Raya 2026' : '';
  $('#f-refresh').hidden = own || !ed.id || state.store.kind !== 'file';
  const current = byId(ed.id);
  $('#editor-heading').textContent = current ? `Edit ${catNo(current)}` : own ? 'Buat playlist sendiri' : 'Tambah playlist';
  $('#f-save').textContent = current ? 'Simpan' : own ? (ed.pendingSong ? 'Buat & masukkan lagu' : 'Buat playlist') : 'Masukkan dalam rak';
  $('#f-title-hint').textContent = own && !current
    ? ed.pendingSong
      ? `“${ed.pendingSong.title}” akan jadi lagu pertama.`
      : 'Lepas ni cari lagu dan tekan + untuk isi playlist ni.'
    : '';
  renderCoverPreview();
}

function closeEditor() {
  $('#editor').close();
}

function setBulkMode(on) {
  $('#bulk-field').hidden = !on;
  $('#link-field').hidden = on || ed.mode === 'own';
  $('#single-fields').hidden = on;
  $('#fav-field').hidden = on;
  $('#editor-mode').hidden = on || Boolean(ed.id || ed.pendingSong);
  if (!on) {
    ed.bulk = null;
    $('#f-save').textContent = ed.id ? 'Simpan' : ed.mode === 'own' ? 'Buat playlist' : 'Masukkan dalam rak';
  }
}

async function getMeta(url) {
  try {
    const res = await api(`api/meta?url=${encodeURIComponent(url)}`);
    const body = await res.json();
    return body.ok ? body : null;
  } catch {
    return null;
  }
}

async function fetchMeta({ force = false } = {}) {
  const typed = f.url.value.trim();
  const info = parseLink(typed);
  if (!info || state.store.kind !== 'file') {
    renderUrlHint();
    return;
  }
  if (!force && ed.metaFor === info.url) {
    renderUrlHint();
    return;
  }
  ed.metaFor = info.url;
  const req = ++ed.metaReq;
  ed.status = 'loading';
  renderUrlHint();

  const meta = await getMeta(info.url);
  if (req !== ed.metaReq) return; // pengguna dah tukar link
  if (!meta) {
    ed.status = 'fail';
    renderUrlHint();
    return;
  }
  if (meta.url && meta.url !== info.url && canon(f.url.value) === info.url) {
    f.url.value = meta.url;
    ed.metaFor = meta.url;
  }
  if (meta.title && (force || !f.title.value.trim() || f.title.value === ed.autoTitle)) {
    f.title.value = meta.title;
    ed.autoTitle = meta.title;
    f.title.removeAttribute('aria-invalid');
    $('#f-title-hint').textContent = '';
  }
  if (meta.cover && (force || (!ed.upload && (!f.cover.value.trim() || f.cover.value === ed.autoCover)))) {
    ed.upload = '';
    f.cover.value = meta.cover;
    ed.autoCover = meta.cover;
  }
  if (meta.author) ed.author = meta.author;
  ed.status = meta.title ? 'ok' : 'partial';
  renderUrlHint();
  renderCoverPreview();
}

function renderUrlHint() {
  const hint = $('#f-url-hint');
  const typed = f.url.value.trim();
  hint.dataset.tone = '';
  if (!typed) {
    hint.innerHTML = 'Spotify, YouTube, SoundCloud, Apple Music, Deezer, JOOX… semua boleh. <b>Ada banyak?</b> Tampal semua link sekali gus.';
    return;
  }
  const info = parseLink(typed);
  if (!info) {
    hint.dataset.tone = 'warn';
    hint.textContent = 'Ni tak nampak macam link. Salin link dari butang Share dalam app muzik kau.';
    return;
  }
  const pf = PLATFORMS[info.platform] ?? PLATFORMS.other;
  const bits = [
    `<span class="pf" style="--pf:${pf.color}">${esc(platformName(info.platform, info.url))}</span>`,
    esc(KIND_LABEL[info.kind] ?? 'Link'),
    info.embed ? 'boleh main dalam app' : info.short ? 'link pendek' : 'dibuka kat app asal',
  ];
  let html = bits.join(' · ');
  const statusText = {
    loading: 'Tengah ambil tajuk & cover',
    ok: 'Tajuk & cover dah diisi.',
    partial: 'Tak jumpa tajuk — isi sendiri.',
    fail: 'Tak dapat ambil info dari link ni — isi tajuk sendiri.',
  }[ed.status];
  if (statusText) html += `<br><span class="hint-status is-${ed.status}">${statusText}</span>`;
  else if (state.store.kind !== 'file') html += '<br>Isi tajuk sendiri (auto-isi perlukan server START.bat).';
  const dup = state.data.playlists.find((p) => p.id !== ed.id && !isOwn(p) && canon(p.url) === info.url);
  if (dup) {
    hint.dataset.tone = 'warn';
    html += `<br>Dah ada dalam rak: <b>${catNo(dup)} · ${esc(dup.title)}</b>`;
  }
  hint.innerHTML = html;
}

function renderCoverPreview() {
  const box = $('#f-cover-preview');
  const src = ed.upload || (ed.mode === 'own' && !ed.id ? '' : f.cover.value.trim());
  const current = byId(ed.id);
  const fake = {
    title: f.title.value.trim() || 'Playlist baru',
    no: current?.no ?? 0,
    sample: current?.sample,
    platform: ed.mode === 'own' ? 'dynoz' : 'other',
    tracks: current?.tracks ?? (ed.pendingSong ? [makeTrack(ed.pendingSong)] : []),
  };
  $('#f-cover-clear').hidden = !src;
  if (src && validCover(src) && !brokenCovers.has(src)) {
    box.innerHTML = `<img alt="" src="${esc(src)}" referrerpolicy="no-referrer"${isYtThumb(src) ? ' class="crop-yt"' : ''}>`;
    box.querySelector('img').addEventListener('error', () => {
      brokenCovers.add(src);
      box.innerHTML = genCoverHTML(fake);
    }, { once: true });
  } else {
    box.innerHTML = (fake.platform === 'dynoz' && mosaicHTML(fake)) || genCoverHTML(fake);
  }
}

function renderTagSuggest() {
  const typed = new Set(tagList(f.tags.value));
  const counts = new Map();
  for (const p of state.data.playlists) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const pool = [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  for (const t of ['chill', 'gaming', 'study', 'gym', 'jiwang', 'raya', 'tidur', 'road trip']) if (!pool.includes(t)) pool.push(t);
  $('#f-tag-suggest').innerHTML = pool
    .filter((t) => !typed.has(t))
    .slice(0, 10)
    .map((t) => `<button type="button" class="tag-mini" data-add-tag="${esc(t)}">+ ${esc(t)}</button>`)
    .join('');
}

async function squareImage(file, max) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(max, side);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', 0.82);
}

function titleMissing(message) {
  f.title.setAttribute('aria-invalid', 'true');
  $('#f-title-hint').textContent = message;
  f.title.focus();
}

function submitSingle() {
  const info = parseLink(f.url.value.trim());
  if (!info) {
    f.url.setAttribute('aria-invalid', 'true');
    renderUrlHint();
    if (!f.url.value.trim()) {
      $('#f-url-hint').dataset.tone = 'warn';
      $('#f-url-hint').textContent = 'Tampal link playlist dulu.';
    }
    f.url.focus();
    return;
  }
  const title = f.title.value.trim();
  if (!title) {
    titleMissing(ed.status === 'loading' ? 'Tunggu sekejap, tengah ambil tajuk…' : 'Letak tajuk dulu.');
    return;
  }
  const coverTyped = f.cover.value.trim();
  const fields = {
    url: info.url,
    platform: info.platform,
    kind: info.kind,
    title,
    cover: ed.upload || (validCover(coverTyped) ? coverTyped : ''),
    author: ed.author,
    tags: tagList(f.tags.value),
    notes: f.notes.value.trim(),
    favorite: f.fav.checked,
    updatedAt: nowISO(),
  };

  let p;
  if (ed.id) {
    p = byId(ed.id);
    if (!p) return closeEditor();
    const urlChanged = p.url !== fields.url;
    if (p.sample) {
      // Contoh yang diedit jadi milik kau — dapat nombor katalog sebenar.
      delete p.sample;
      p.no = state.data.nextNo++;
    }
    Object.assign(p, fields);
    if (urlChanged && state.now?.kind === 'embed' && state.now.playlistId === p.id) loadPlayer(p);
    toast('Perubahan disimpan');
  } else {
    p = {
      id: uid(),
      no: state.data.nextNo++,
      ...fields,
      plays: 0,
      lastPlayedAt: null,
      createdAt: fields.updatedAt,
    };
    state.data.playlists.push(p);
    if (!passes(p, fold(state.query).split(/\s+/).filter(Boolean))) resetFilters();
    toast(`${catNo(p)} dah masuk rak`);
  }
  closeEditor();
  commit();
  if (state.view !== 'rack') setView('rack');
  flashCard(p.id);
}

function submitOwn() {
  const title = f.title.value.trim();
  if (!title) {
    titleMissing('Beri nama playlist dulu.');
    return;
  }
  const coverTyped = f.cover.value.trim();
  const fields = {
    title,
    cover: ed.upload || (ed.id && validCover(coverTyped) ? coverTyped : ''),
    tags: tagList(f.tags.value),
    notes: f.notes.value.trim(),
    favorite: f.fav.checked,
    updatedAt: nowISO(),
  };

  if (ed.id) {
    const p = byId(ed.id);
    if (!p) return closeEditor();
    Object.assign(p, fields);
    closeEditor();
    commit();
    toast('Perubahan disimpan');
    return;
  }

  const song = ed.pendingSong;
  const p = {
    id: uid(),
    no: state.data.nextNo++,
    url: '',
    platform: 'dynoz',
    kind: 'playlist',
    author: '',
    ...fields,
    tracks: song ? [makeTrack(song)] : [],
    plays: 0,
    lastPlayedAt: null,
    createdAt: fields.updatedAt,
  };
  state.data.playlists.push(p);
  state.target = p.id;
  savePrefs();
  closeEditor();
  commit();
  if (song) {
    toast(`${p.title} dicipta · “${song.title}” masuk`);
  } else {
    toast(`${p.title} dicipta. Cari lagu, tekan + untuk isi.`);
    setView('songs', { focus: true });
  }
}

/* ---------- Tambah banyak link sekali gus ---------- */

function startBulk(links) {
  const have = new Map(state.data.playlists.filter((p) => !isOwn(p)).map((p) => [canon(p.url), p]));
  ed.bulk = links.map((raw) => {
    const info = parseLink(raw);
    const dup = info ? have.get(info.url) : null;
    // Link yang dah ada: tunjuk tajuk & cover playlist sedia ada
    const meta = dup ? { title: `${catNo(dup)} · ${dup.title}`, cover: dup.cover } : null;
    return { raw, info, meta, status: !info ? 'bad' : dup ? 'dup' : 'wait' };
  });
  f.url.value = '';
  setBulkMode(true);
  renderBulk();
  ed.bulkRun = runBulkMeta(ed.bulk);
}

async function runBulkMeta(items) {
  if (state.store.kind !== 'file') {
    for (const it of items) if (it.status === 'wait') it.status = 'ready';
    renderBulk();
    return;
  }
  const queue = items.filter((it) => it.status === 'wait');
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      if (ed.bulk !== items) return;
      it.status = 'loading';
      renderBulk();
      const meta = await getMeta(it.info.url);
      it.meta = meta;
      if (meta?.url) it.info = parseLink(meta.url) ?? it.info;
      it.status = 'ready';
      if (ed.bulk === items) renderBulk();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

function fallbackTitle(info) {
  const kind = (KIND_LABEL[info.kind] ?? 'Link').toLowerCase();
  return `${platformName(info.platform, info.url)} ${kind}${info.id ? ` ${info.id.slice(0, 6)}` : ''}`;
}

function renderBulk() {
  const items = ed.bulk ?? [];
  const ready = items.filter((it) => it.status !== 'bad' && it.status !== 'dup').length;
  $('#bulk-label').textContent = `${items.length} link dijumpai`;
  $('#bulk-list').innerHTML = items
    .map((it, i) => {
      const info = it.info;
      const title = it.meta?.title || (info ? fallbackTitle(info) : it.raw);
      const pf = PLATFORMS[info?.platform] ?? PLATFORMS.other;
      const fake = { title, no: 0, cover: it.meta?.cover ?? '' };
      const status = {
        wait: 'Menunggu',
        loading: 'Cari info…',
        ready: 'Sedia',
        dup: 'Dah ada',
        bad: 'Link rosak',
      }[it.status];
      return `
<li class="bulk-item" data-i="${i}">
  <span class="thumb">${coverHTML(fake, { lazy: false })}</span>
  <span class="bulk-text">
    <strong title="${esc(title)}">${esc(title)}</strong>
    ${info ? `<span class="pf" style="--pf:${pf.color}">${esc(platformName(info.platform, info.url))} · ${esc(KIND_LABEL[info.kind] ?? 'Link')}</span>` : ''}
  </span>
  <span class="bulk-status is-${it.status}">${status}</span>
</li>`;
    })
    .join('');
  $('#f-save').textContent = ready ? `Masukkan ${ready} playlist` : 'Tiada yang baru';
  $('#f-save').disabled = !ready;
}

async function submitBulk() {
  const items = ed.bulk;
  const save = $('#f-save');
  save.disabled = true;
  save.textContent = 'Tengah ambil info…';
  await ed.bulkRun?.catch(() => {});
  if (ed.bulk !== items) return;

  const tags = tagList(f.tags.value);
  const have = new Set(state.data.playlists.map((p) => canon(p.url)));
  const base = Date.now();
  let added = 0;
  let skipped = 0;
  items.forEach((it, i) => {
    if (!it.info || have.has(it.info.url)) {
      skipped += 1;
      return;
    }
    have.add(it.info.url);
    const at = new Date(base + i).toISOString();
    state.data.playlists.push({
      id: uid(),
      no: state.data.nextNo++,
      url: it.info.url,
      platform: it.info.platform,
      kind: it.info.kind,
      title: it.meta?.title || fallbackTitle(it.info),
      cover: it.meta?.cover || '',
      author: it.meta?.author || '',
      notes: '',
      tags,
      favorite: false,
      plays: 0,
      lastPlayedAt: null,
      createdAt: at,
      updatedAt: at,
    });
    added += 1;
  });
  save.disabled = false;
  closeEditor();
  if (added) {
    resetFilters();
    commit();
    if (state.view !== 'rack') setView('rack');
  }
  toast(added ? `${added} playlist masuk rak${skipped ? ` · ${skipped} dilangkau` : ''}` : 'Semua link tu dah ada dalam rak.');
}

/* ================================================================== */
/* Event                                                               */
/* ================================================================== */

function bindEvents() {
  const search = $('#search');
  const dialog = $('#editor');
  const menu = $('#menu');

  // --- Paparan (tab dalam bar alat + bar navigasi bawah di phone) ---
  for (const nav of [$('#viewtabs'), $('#bottomnav')]) {
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) setView(b.dataset.view, { focus: b.dataset.view === 'songs' });
    });
  }

  // --- Rak ---
  $('#grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!card || !act) return;
    if (act === 'fav') toggleFav(card.dataset.id);
    else if (act === 'play') play(card.dataset.id);
  });
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement) imageFailed(e.target);
  }, true);

  // --- Butang am (nota contoh, keadaan kosong, cari lagu) ---
  $('#main').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.closest('#grid')) return;
    const act = btn.dataset.act;
    if (act === 'add') openEditor(null, { mode: 'link' });
    else if (act === 'new-own') openEditor(null, { mode: 'own' });
    else if (act === 'remove-samples') removeSamples();
    else if (act === 'load-samples') loadSamples();
    else if (act === 'reset') {
      resetFilters();
      renderFilters();
      renderGrid();
    } else if (act === 'search-songs') {
      const q = state.query.trim();
      resetFilters();
      searchSongsFor(q);
    } else if (act === 'song-q') {
      search.value = btn.dataset.q;
      state.songs.typed = btn.dataset.q;
      runSongSearch(btn.dataset.q, { force: true });
    } else if (act === 'song-retry') {
      runSongSearch(state.songs.q, { force: true });
    } else if (act === 'target-menu') {
      openTargetMenu(btn);
    } else if (act === 'target-play') {
      const t = ensureTarget();
      if (t) startQueue(t.id);
    } else if (act === 'song-play' || act === 'song-add') {
      const r = findResult(btn.closest('[data-vid]')?.dataset.vid);
      if (!r) return;
      if (act === 'song-add') toggleInTarget(r);
      else if (r.embeddable === false) window.open(ytWatch(r.videoId), '_blank', 'noopener');
      else if (currentTrack()?.videoId === r.videoId && state.now?.kind !== 'embed') songPlayer.toggle();
      else playSong(r);
    }
  });

  // --- Tapisan rak ---
  $('#pills').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    renderFilters();
    renderGrid();
  });
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (b) setTag(state.tag === b.dataset.tag ? null : b.dataset.tag);
  });
  search.addEventListener('input', () => {
    if (state.view === 'rack') {
      state.query = search.value;
      renderGrid();
    } else {
      state.songs.typed = search.value;
      clearTimeout(songTimer);
      songTimer = setTimeout(() => runSongSearch(search.value), 650);
    }
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.view === 'songs') {
      e.preventDefault();
      runSongSearch(search.value, { force: true });
      if (touchOnly.matches) search.blur();
    } else if (e.key === 'Escape' && search.value) {
      e.preventDefault();
      search.value = '';
      if (state.view === 'rack') {
        state.query = '';
        renderGrid();
      } else {
        state.songs.typed = '';
        runSongSearch('');
      }
    }
  });
  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    savePrefs();
    renderGrid();
  });

  // --- Bar alat ---
  $('#add-btn').addEventListener('click', () => openEditor());
  const toolbar = $('#toolbar');
  const masthead = $('.masthead');
  addEventListener('scroll', () => toolbar.classList.toggle('is-stuck', scrollY > masthead.offsetHeight + 4), { passive: true });

  // --- Deck ---
  $('#deck').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const p = nowPlaylist();
    if (!btn) {
      if (narrow.matches && e.target.closest('.deck-bar')) setExpanded(!state.expanded);
      return;
    }
    const key = btn.closest('[data-key]')?.dataset.key;
    switch (btn.dataset.act) {
      case 'close': closePlayer(); break;
      case 'toggle': setExpanded(!state.expanded); break;
      case 'playpause': songPlayer.toggle(); break;
      case 'next': step(1); break;
      case 'prev': prevOrRestart(); break;
      case 'shuffle':
        state.shuffle = !state.shuffle;
        savePrefs();
        if (state.now?.kind === 'queue' && p) {
          const rest = playableKeys(p).filter((k) => k !== state.now.key);
          state.now.order = state.shuffle ? [state.now.key, ...shuffled(rest)].filter(Boolean) : playableKeys(p);
        }
        renderDeck();
        toast(state.shuffle ? 'Main rawak: hidup' : 'Main rawak: mati');
        break;
      case 'repeat': {
        // Kitar: ulang playlist → ulang lagu ni → mati
        const modes = ['all', 'one', 'off'];
        state.repeatMode = modes[(modes.indexOf(state.repeatMode) + 1) % modes.length];
        savePrefs();
        renderDeck();
        toast(`Ulang: ${REPEAT_LABEL[state.repeatMode]}`);
        break;
      }
      case 'fav': if (p) toggleFav(p.id); break;
      case 'edit': if (p) openEditor(p.id); break;
      case 'copy':
        if (p) copyText(p.url).then((ok) => toast(ok ? 'Link disalin' : 'Tak dapat salin link'));
        break;
      case 'delete': if (p) removePlaylists([p.id], `“${p.title}” dipadam`); break;
      case 'tag':
        setView('rack');
        setTag(btn.dataset.tag);
        setExpanded(false);
        break;
      case 'add-songs':
        if (p && isOwn(p)) {
          state.target = p.id;
          savePrefs();
        }
        setExpanded(false);
        setView('songs', { focus: true });
        renderSongs();
        break;
      case 'track-play':
        if (p && key) {
          const t = p.tracks.find((x) => x.key === key);
          if (t?.blocked) window.open(ytWatch(t.videoId), '_blank', 'noopener');
          else if (state.now?.kind === 'queue' && state.now.key === key) songPlayer.toggle();
          else startQueue(p.id, key);
        }
        break;
      case 'track-menu':
        if (p && key) openTrackMenu(btn, p.id, key);
        break;
      case 'song-add-now':
        if (state.now?.kind === 'song') toggleInTarget(state.now.track);
        break;
      default:
    }
  });
  $('#scrim').addEventListener('click', () => setExpanded(false));
  narrow.addEventListener('change', () => setExpanded(false));

  // --- Menu utama ---
  menu.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = $('#menu-btn').getBoundingClientRect();
    const width = 272;
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(r.right - width, innerWidth - width - 8)))}px`;
  });
  menu.addEventListener('click', (e) => {
    const themeBtn = e.target.closest('[data-theme-set]');
    if (themeBtn) {
      setTheme(themeBtn.dataset.themeSet);
      return;
    }
    const act = e.target.closest('[data-menu]')?.dataset.menu;
    if (!act) return;
    menu.hidePopover();
    if (act === 'export') exportData();
    else if (act === 'import') $('#import-file').click();
    else if (act === 'remove-samples') removeSamples();
    else if (act === 'new-own') openEditor(null, { mode: 'own' });
    else if (act === 'logout') logout();
    else if (act === 'install') installApp();
  });
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importFile(file);
  });
  applyTheme(getTheme());

  // --- Popover: pilih playlist sasaran & pilihan lagu ---
  for (const pop of [$('#target-menu'), $('#track-menu')]) {
    pop.addEventListener('toggle', (e) => {
      if (e.newState === 'closed') pop.closedAt = performance.now();
    });
  }
  $('#target-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-target]');
    if (!b) return;
    $('#target-menu').hidePopover();
    if (b.dataset.target === 'new') {
      openEditor(null, { mode: 'own' });
      return;
    }
    state.target = b.dataset.target;
    savePrefs();
    renderSongs();
    renderDeck();
  });
  $('#track-menu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-track-act]');
    const pop = $('#track-menu');
    if (!item) return;
    const p = byId(pop.dataset.pid);
    const key = pop.dataset.key;
    pop.hidePopover();
    if (!p || item.dataset.trackAct === 'open') return; // link biasa, biar browser buka
    switch (item.dataset.trackAct) {
      case 'play': startQueue(p.id, key); break;
      case 'up': moveTrack(p, key, -1); break;
      case 'down': moveTrack(p, key, 1); break;
      case 'remove': removeTrack(p, key); break;
      default:
    }
  });

  // --- Dialog ---
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeEditor();
  });
  dialog.addEventListener('close', () => {
    ed.metaReq += 1;
    ed.bulk = null;
    ed.pendingSong = null;
    clearTimeout(urlTimer);
    clearTimeout(coverTimer);
    $('#f-save').disabled = false;
  });
  $('#editor-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === ed.mode) return;
    ed.mode = b.dataset.mode;
    applyEditorMode();
    renderUrlHint();
    (ed.mode === 'own' ? f.title : f.url).focus();
  });
  $('#editor-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (ed.bulk) submitBulk();
    else if (ed.mode === 'own') submitOwn();
    else submitSingle();
  });

  f.url.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    const links = extractLinks(text);
    if (links.length > 1 && !ed.id) {
      e.preventDefault();
      startBulk(links);
    } else if (links.length === 1 && !parseLink(text.trim())) {
      // Contoh: "Dengar playlist ni kat Spotify: https://open.spotify.com/..." — ambil link je
      e.preventDefault();
      f.url.value = links[0];
      f.url.dispatchEvent(new Event('input'));
    }
  });
  f.url.addEventListener('input', () => {
    const info = parseLink(f.url.value.trim());
    if (!info || info.url !== ed.metaFor) ed.status = 'idle';
    f.url.removeAttribute('aria-invalid');
    renderUrlHint();
    clearTimeout(urlTimer);
    urlTimer = setTimeout(fetchMeta, 450);
  });
  f.title.addEventListener('input', () => {
    f.title.removeAttribute('aria-invalid');
    if (ed.mode !== 'own') $('#f-title-hint').textContent = '';
    if (!ed.upload && !f.cover.value.trim()) renderCoverPreview();
  });
  f.cover.addEventListener('input', () => {
    ed.upload = '';
    clearTimeout(coverTimer);
    coverTimer = setTimeout(renderCoverPreview, 350);
  });
  f.tags.addEventListener('input', renderTagSuggest);
  $('#f-tag-suggest').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add-tag]');
    if (!b) return;
    const current = f.tags.value.split(',').map((s) => s.trim()).filter(Boolean);
    current.push(b.dataset.addTag);
    f.tags.value = `${current.join(', ')}, `;
    renderTagSuggest();
    f.tags.focus();
  });
  $('#f-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const links = extractLinks(text);
      if (links.length > 1 && !ed.id) {
        startBulk(links);
        return;
      }
      f.url.value = links[0] ?? text.trim();
      f.url.dispatchEvent(new Event('input'));
      f.url.focus();
    } catch {
      toast('Tak dapat baca clipboard — klik kotak link dan tekan Ctrl+V.');
    }
  });
  $('#f-cover-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Pilih fail gambar (JPG, PNG atau WebP).', { tone: 'error' });
      return;
    }
    try {
      ed.upload = await squareImage(file, 400); // kecil supaya muat dalam storan online
      f.cover.value = '';
      renderCoverPreview();
    } catch {
      toast('Gambar tu tak dapat dibaca. Cuba gambar lain.', { tone: 'error' });
    }
  });
  $('#f-cover-clear').addEventListener('click', () => {
    ed.upload = '';
    ed.autoCover = '';
    f.cover.value = '';
    renderCoverPreview();
  });
  $('#f-refresh').addEventListener('click', () => fetchMeta({ force: true }));
  $('#f-delete').addEventListener('click', () => {
    const p = byId(ed.id);
    closeEditor();
    if (p) removePlaylists([p.id], `“${p.title}” dipadam`);
  });
  $('#bulk-list').addEventListener('error', (e) => {
    if (e.target.tagName !== 'IMG') return;
    brokenCovers.add(e.target.getAttribute('src'));
    const it = ed.bulk?.[Number(e.target.closest('[data-i]')?.dataset.i)];
    const holder = document.createElement('div');
    holder.innerHTML = genCoverHTML({ title: it?.meta?.title ?? '', no: 0 });
    e.target.replaceWith(holder.firstElementChild);
  }, true);
  $('#bulk-cancel').addEventListener('click', () => {
    setBulkMode(false);
    renderUrlHint();
    f.url.focus();
  });

  // --- Papan kekunci ---
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || dialog.open) return;
    if (e.key === 'Escape' && state.expanded) {
      setExpanded(false);
      return;
    }
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === '/') {
      e.preventDefault();
      search.focus();
      search.select();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openEditor();
    }
  });
}
