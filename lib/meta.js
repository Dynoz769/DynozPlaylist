// Ambil info playlist dari link: tajuk, gambar cover, pemilik.
// Spotify / YouTube / SoundCloud guna oEmbed rasmi, Deezer guna API awam, yang lain baca tag Open Graph.

import { parseLink } from '../public/js/platforms.js';
import { UA, decodeEntities, httpError, readLimited } from './util.js';

const metaCache = new Map();
const tidy = (s) => String(s ?? '').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Jangan biar server ni dipakai untuk buka alamat dalam rangkaian dalaman.
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

function metaTag(html, key) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, 'i'))?.[0];
  if (!tag) return '';
  const m = tag.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return m ? decodeEntities(m[1] ?? m[2]).trim() : '';
}

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

export async function getMeta(rawUrl) {
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
  if (value.title) {
    metaCache.set(info.url, { at: Date.now(), value });
    if (metaCache.size > 500) metaCache.delete(metaCache.keys().next().value);
  }
  return value;
}
