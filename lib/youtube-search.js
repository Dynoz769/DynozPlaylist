// Carian lagu dari YouTube untuk ciri "Cari lagu".
//
//   * Ada YOUTUBE_API_KEY → guna YouTube Data API v3 (rasmi; kuota percuma lebih kurang 100 carian sehari)
//   * Tiada key           → baca halaman carian awam YouTube. Tak perlu setup, tapi bukan cara rasmi:
//                           boleh berhenti berfungsi kalau YouTube ubah halaman dia.
//
// Setiap hasil ditanda `embeddable` supaya app tahu lagu mana boleh dimainkan dalam app.
// Tetapan datang dari configureSearch() — server.js (Node) dan worker.js (Cloudflare) masing-masing panggil.

import { UA, decodeEntities } from './util.js';

const CACHE_MS = 30 * 60 * 1000;
let API_KEY = '';
let REGION = 'MY';

const cache = new Map(); // carian -> { at, value }
const embedCache = new Map(); // videoId -> boolean
let apiPausedUntil = 0;

export function configureSearch({ apiKey, region } = {}) {
  API_KEY = String(apiKey ?? '').trim();
  REGION = String(region || 'MY').trim().toUpperCase();
}

export const searchMode = () => (API_KEY ? 'api' : 'web');

export async function searchSongs(query) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (q.length < 2) return { source: 'none', results: [] };

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value = null;
  if (API_KEY && Date.now() > apiPausedUntil) {
    try {
      value = await viaApi(q);
    } catch (err) {
      apiPausedUntil = Date.now() + (err.quota ? 60 : 5) * 60 * 1000;
      console.warn(`  ! YouTube API gagal (${err.message}) — guna carian web buat sementara.`);
    }
  }
  value ??= await viaWeb(q);

  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

/* ---------------- Tanpa key: halaman carian awam ---------------- */

async function viaWeb(q) {
  const params = new URLSearchParams({ search_query: q, sp: 'EgIQAQ==', hl: 'en', gl: REGION }); // sp = video sahaja
  const res = await fetch(`https://www.youtube.com/results?${params}`, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'SOCS=CAI; CONSENT=YES+1' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`YouTube balas ${res.status}`);
  const data = initialData(await res.text());
  if (!data) throw new Error('Format halaman carian YouTube dah berubah');

  const results = [];
  collect(data, results);
  const top = fixSwapped(results.slice(0, 20));
  await checkEmbeddable(top);
  return { source: 'web', results: top };
}

// Ambil objek JSON `ytInitialData` dari HTML (cari kurungan penutup yang sepadan).
function initialData(html) {
  const marker = html.search(/(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*\{/);
  if (marker < 0) return null;
  const start = html.indexOf('{', marker);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const text = (t) => t?.simpleText ?? (t?.runs ?? []).map((r) => r.text).join('');

function collect(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return;
  }
  if (node.videoRenderer) {
    const song = fromRenderer(node.videoRenderer);
    if (song && !out.some((s) => s.videoId === song.videoId)) out.push(song);
    return;
  }
  for (const key of Object.keys(node)) collect(node[key], out);
}

function fromRenderer(v) {
  if (!/^[\w-]{11}$/.test(v.videoId ?? '')) return null;
  const length = text(v.lengthText);
  const badges = [...(v.badges ?? []), ...(v.ownerBadges ?? [])]
    .map((b) => `${b.metadataBadgeRenderer?.label ?? ''} ${b.metadataBadgeRenderer?.tooltip ?? ''} ${b.metadataBadgeRenderer?.style ?? ''}`)
    .join(' ');
  return song({
    id: v.videoId,
    raw: text(v.title),
    channel: text(v.ownerText) || text(v.longBylineText) || text(v.shortBylineText),
    duration: clockToSec(length),
    live: !length || /\bLIVE\b|LIVE_NOW/i.test(badges),
    official: /VERIFIED_ARTIST|Official Artist/i.test(badges),
    views: Number(text(v.viewCountText).replace(/\D/g, '')) || 0,
  });
}

// oEmbed balas 401 untuk video yang pemiliknya tak benarkan dimainkan di laman lain.
async function checkEmbeddable(list) {
  await Promise.all(list.map(async (s) => {
    if (embedCache.has(s.videoId)) {
      s.embeddable = embedCache.get(s.videoId);
      return;
    }
    try {
      const target = `https://www.youtube.com/watch?v=${s.videoId}`;
      const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(3500),
      });
      res.body?.cancel().catch(() => {});
      s.embeddable = res.status !== 401 && res.status !== 403;
      embedCache.set(s.videoId, s.embeddable);
      if (embedCache.size > 3000) embedCache.delete(embedCache.keys().next().value);
    } catch {
      s.embeddable = true; // tak pasti — pemain akan langkau sendiri kalau gagal
    }
  }));
}

/* ---------------- Dengan key: YouTube Data API v3 ---------------- */

async function apiGet(endpoint, params) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams({ ...params, key: API_KEY })}`, {
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason ?? `HTTP ${res.status}`;
    throw Object.assign(new Error(reason), { quota: /quota|rateLimit/i.test(reason) });
  }
  return body;
}

async function viaApi(q) {
  const found = await apiGet('search', {
    part: 'snippet', type: 'video', maxResults: '20', q, videoEmbeddable: 'true', regionCode: REGION,
  });
  const ids = (found.items ?? []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return { source: 'api', results: [] };
  const details = await apiGet('videos', { part: 'contentDetails,status,statistics', id: ids.join(',') });
  const info = new Map((details.items ?? []).map((i) => [i.id, i]));

  const results = [];
  for (const item of found.items) {
    const id = item.id?.videoId;
    if (!id) continue;
    const d = info.get(id);
    const channel = decodeEntities(item.snippet?.channelTitle);
    results.push(song({
      id,
      raw: decodeEntities(item.snippet?.title),
      channel,
      duration: isoToSec(d?.contentDetails?.duration),
      live: item.snippet?.liveBroadcastContent === 'live',
      official: /VEVO$|\s-\sTopic$/.test(channel),
      views: Number(d?.statistics?.viewCount) || 0,
      embeddable: d?.status?.embeddable !== false,
    }));
  }
  return { source: 'api', results: fixSwapped(results) };
}

/* ---------------- Kemaskan tajuk ---------------- */

const NOISE = /\b(?:official|music\s*video|lyrics?|lirik|audio|video|mv|m\/v|visuali[sz]er|hd|hq|4k|explicit|rasmi|muzik|klip|remaster(?:ed)?|full\s*album)\b/i;

const squash = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');

// "SEMALAM" → "Semalam" (perkataan pendek macam OST, BTS, DJ dibiarkan)
const tidyCaps = (s) => (/\p{Ll}/u.test(s) ? s : s.replace(/\p{L}[\p{L}'’]*/gu, (w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())));

/** "Hindia - Evaluasi (Official Music Video)" → { title: "Evaluasi", artist: "Hindia", note: "Official Music Video" } */
export function cleanSong(raw, channel) {
  let text = String(raw ?? '').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
  const notes = [];
  text = text.replace(/\s*[([【]([^()[\]【】]{1,80})[)\]】]/g, (m, inner) => {
    if (!NOISE.test(inner)) return m;
    notes.push(inner.trim());
    return '';
  });

  // Pecah ikut " - " dan " | ". Bahagian yang sama dengan nama channel = artis.
  const parts = text.split(/\s+([-–—]|[|｜]+)\s+/);
  const segments = parts.filter((_, i) => i % 2 === 0).map((s) => s.trim()).filter(Boolean);
  const firstSep = parts[1] ?? '';
  let chan = String(channel ?? '').replace(/\s*-\s*Topic$/i, '').trim();
  if (/VEVO$/i.test(chan)) chan = chan.replace(/\s*VEVO$/i, '').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'); // "FaizalTahirVEVO" → "Faizal Tahir"
  const chanKey = squash(chan);
  const isArtist = (s) => {
    const k = squash(s);
    return Boolean(k) && (k === chanKey || (chanKey.length >= 6 && k.includes(chanKey)));
  };

  let artist = '';
  let title = segments[0] ?? text;
  let rest = segments.slice(1);
  let guessed = false; // artis diteka ikut kebiasaan "Artis - Lagu" (mungkin terbalik)
  const artistAt = chanKey.length >= 2 ? segments.findIndex(isArtist) : -1;
  if (artistAt >= 0 && segments.length > 1) {
    artist = segments[artistAt];
    const others = segments.filter((_, i) => i !== artistAt);
    title = others[0];
    rest = others.slice(1);
  } else if (segments.length > 1 && /^[-–—]$/.test(firstSep)) {
    [artist, title] = segments; // kebiasaan "Artis - Lagu"
    rest = segments.slice(2);
    guessed = true;
  }
  if (!artist) artist = chan;
  if (!artist && rest.length && !NOISE.test(rest[0])) artist = rest.shift();
  notes.push(...rest);

  title = title.replace(/\s+(?:official\s+(?:music\s+|lyric\s+)?(?:video|audio|mv)|m\/?v|lyric\s+video|lirik)$/i, (m) => {
    notes.push(m.trim());
    return '';
  });
  title = title.replace(/^["'“‘](.+)["'”’]$/, '$1').trim();
  return {
    title: tidyCaps(title || String(raw ?? '').trim()),
    artist: tidyCaps(artist),
    note: notes.join(' · ').slice(0, 120),
    guessed,
  };
}

// Sesetengah video guna susunan "Lagu - Artis". Kalau "tajuk" yang diteka mengandungi nama artis
// yang muncul berkali-kali dalam hasil lain (contoh: "Aina Abdul"), tukar balik.
function fixSwapped(results) {
  const counts = new Map();
  for (const r of results) {
    if (r.guessed) continue;
    const k = squash(r.artist);
    if (k.length >= 4) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const known = [...counts].filter(([, n]) => n >= 2).map(([k]) => k);
  for (const r of results) {
    if (r.guessed && known.length) {
      const hasArtist = (s) => known.some((k) => squash(s).includes(k));
      if (hasArtist(r.title) && !hasArtist(r.artist)) [r.title, r.artist] = [r.artist, r.title];
    }
    delete r.guessed;
  }
  return results;
}

function song({ id, raw, channel, duration, live, official, views, embeddable = true }) {
  const { title, artist, note, guessed } = cleanSong(raw, channel);
  return {
    videoId: id,
    title,
    artist,
    note,
    guessed,
    channel: String(channel ?? ''),
    duration: duration || 0,
    live: Boolean(live),
    official: Boolean(official),
    views: views || 0,
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    embeddable,
  };
}

function clockToSec(s) {
  const parts = String(s ?? '').trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function isoToSec(iso) {
  const m = String(iso ?? '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}
