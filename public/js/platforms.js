// Kenal pasti platform muzik dari link, dan bina link "embed" untuk main terus dalam app.
// Fail ni dikongsi: browser (app.js) dan server (server.js), jadi jangan guna DOM kat sini.

export const PLATFORMS = {
  dynoz:      { name: 'Buatan sendiri', color: '#FFD23F' }, // playlist yang dibina dalam app (lagu dari YouTube)
  spotify:    { name: 'Spotify',       color: '#1ED760' },
  youtube:    { name: 'YouTube',       color: '#FF0033' },
  ytmusic:    { name: 'YouTube Music', color: '#FF0033' },
  soundcloud: { name: 'SoundCloud',    color: '#FF5500' },
  apple:      { name: 'Apple Music',   color: '#FA2D48' },
  deezer:     { name: 'Deezer',        color: '#A238FF' },
  tidal:      { name: 'TIDAL',         color: '#9FA3C7' },
  joox:       { name: 'JOOX',          color: '#27C26C' },
  amazon:     { name: 'Amazon Music',  color: '#25D1DA' },
  bandcamp:   { name: 'Bandcamp',      color: '#1DA0C3' },
  other:      { name: 'Link lain',     color: '#8C8FB8' },
};

export const KIND_LABEL = {
  playlist: 'Playlist',
  album: 'Album',
  track: 'Lagu',
  artist: 'Artis',
  video: 'Video',
  mix: 'Mix',
  show: 'Podcast',
  episode: 'Episod',
  profile: 'Profil',
  link: 'Link',
};

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function platformName(platform, url) {
  if (platform === 'other') return hostOf(url) || PLATFORMS.other.name;
  return (PLATFORMS[platform] ?? PLATFORMS.other).name;
}

const lastIndex = (parts, test) => {
  for (let i = parts.length - 1; i >= 0; i--) if (test(parts[i])) return i;
  return -1;
};

/**
 * Baca satu link dan pulangkan:
 * { platform, kind, id, url (bentuk kemas), embed: { src, height | ratio } | null, short }
 * `short: true` bermaksud link pendek (spotify.link dan lain-lain) yang server kena buka dulu.
 * Pulangkan null kalau input bukan link.
 */
export function parseLink(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;

  // URI Spotify: spotify:playlist:ID atau spotify:user:nama:playlist:ID
  const uri = s.match(/^spotify:(?:user:[^:\s]+:)?(playlist|album|track|artist|show|episode):([A-Za-z0-9]{22})$/i);
  if (uri) s = `https://open.spotify.com/${uri[1].toLowerCase()}/${uri[2]}`;

  if (!/^https?:\/\//i.test(s)) {
    if (/^(?:[\w-]+\.)+[a-z]{2,}(?:[/?#]|$)/i.test(s)) s = `https://${s}`;
    else return null;
  }

  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname.includes('.')) return null;

  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const q = u.searchParams;
  const plain = (platform, kind = 'link', extra = {}) => ({
    platform, kind, id: '', url: u.href, embed: null, short: false, ...extra,
  });
  const cleanHref = () => `${u.origin}${u.pathname}`.replace(/\/$/, '');

  // ---- Spotify ----
  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const i = lastIndex(parts, (p) => /^(?:playlist|album|track|artist|show|episode)$/i.test(p));
    const id = i >= 0 ? parts[i + 1] ?? '' : '';
    if (/^[A-Za-z0-9]{22}$/.test(id)) {
      const type = parts[i].toLowerCase();
      const small = type === 'track' || type === 'episode';
      return {
        platform: 'spotify', kind: type, id, short: false,
        url: `https://open.spotify.com/${type}/${id}`,
        embed: { src: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`, height: small ? 152 : 352 },
      };
    }
    return plain('spotify');
  }
  if (host === 'spotify.link' || host === 'spotify.app.link') return plain('spotify', 'link', { short: true });

  // ---- YouTube & YouTube Music ----
  if (['youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    const platform = host === 'music.youtube.com' ? 'ytmusic' : 'youtube';
    const site = platform === 'ytmusic' ? 'https://music.youtube.com' : 'https://www.youtube.com';
    let v = q.get('v') ?? '';
    let list = q.get('list') ?? '';
    if (host === 'youtu.be') v = parts[0] ?? '';
    if (['shorts', 'live', 'embed', 'v'].includes(parts[0]) && parts[1] && parts[1] !== 'videoseries') v = parts[1];
    if (parts[0] === 'browse' && /^VL/.test(parts[1] ?? '')) list = parts[1].slice(2);
    if (!/^[\w-]{11}$/.test(v)) v = '';
    if (!/^[\w-]{10,}$/.test(list)) list = '';

    if (list) {
      // Senarai "RD..." ialah Mix automatik — perlu video permulaan. RDCLAK... pula playlist biasa YT Music.
      const isMix = /^RD(?!CLAK)/.test(list);
      if (!isMix) {
        return {
          platform, kind: 'playlist', id: list, short: false,
          url: `${site}/playlist?list=${list}`,
          embed: { src: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, ratio: '16 / 9' },
        };
      }
      if (v) {
        return {
          platform, kind: 'mix', id: list, short: false,
          url: `${site}/watch?v=${v}&list=${list}`,
          embed: { src: `https://www.youtube-nocookie.com/embed/${v}?list=${list}`, ratio: '16 / 9' },
        };
      }
    }
    if (v) {
      return {
        platform, kind: 'video', id: v, short: false,
        url: `${site}/watch?v=${v}`,
        embed: { src: `https://www.youtube-nocookie.com/embed/${v}`, ratio: '16 / 9' },
      };
    }
    const isProfile = (parts[0] ?? '').startsWith('@') || ['channel', 'c', 'user'].includes(parts[0]);
    return plain(platform, isProfile ? 'profile' : 'link');
  }

  // ---- SoundCloud ----
  if (host === 'on.soundcloud.com') return plain('soundcloud', 'link', { short: true });
  if (host === 'soundcloud.com') {
    const reserved = ['discover', 'search', 'you', 'stream', 'upload', 'charts', 'pages', 'settings', 'messages',
      'notifications', 'feed', 'terms-of-use', 'jobs', 'imprint', 'mobile', 'pro', 'people', 'popular'];
    if (!parts.length || reserved.includes(parts[0])) return plain('soundcloud');
    const [, second, third] = parts;
    const profilePages = ['tracks', 'albums', 'likes', 'reposts', 'popular-tracks', 'followers', 'following', 'comments'];
    let kind = 'profile';
    if (second === 'sets') kind = third ? 'playlist' : 'profile';
    else if (second && !profilePages.includes(second)) kind = 'track';
    const keep = kind === 'playlist' ? parts.slice(0, 4) : kind === 'track' ? parts.slice(0, 3) : parts.slice(0, 1);
    const url = `https://soundcloud.com/${keep.join('/')}`;
    const params = new URLSearchParams({
      url, color: '#ff5500', auto_play: 'true', hide_related: 'true', show_comments: 'false',
      show_reposts: 'false', show_teaser: 'false', visual: 'false',
    });
    return {
      platform: 'soundcloud', kind, id: keep.join('/'), url, short: false,
      embed: { src: `https://w.soundcloud.com/player/?${params}`, height: kind === 'track' ? 166 : 420 },
    };
  }

  // ---- Apple Music ----
  if (host === 'apple.co') return plain('apple', 'link', { short: true });
  if (['music.apple.com', 'embed.music.apple.com', 'geo.music.apple.com'].includes(host)) {
    const [cc, type] = parts;
    const types = ['playlist', 'album', 'song', 'artist', 'station', 'music-video'];
    if (/^[a-z]{2}$/i.test(cc ?? '') && types.includes(type) && parts.length >= 3) {
      const song = type === 'album' ? q.get('i') : null;
      const kind = type === 'song' || song ? 'track' : type === 'music-video' ? 'video' : type === 'station' ? 'mix' : type;
      const path = `/${parts.join('/')}${song ? `?i=${encodeURIComponent(song)}` : ''}`;
      const canEmbed = ['playlist', 'album', 'track'].includes(kind);
      return {
        platform: 'apple', kind, id: parts[parts.length - 1], short: false,
        url: `https://music.apple.com${path}`,
        embed: canEmbed ? { src: `https://embed.music.apple.com${path}`, height: kind === 'track' ? 175 : 450 } : null,
      };
    }
    return plain('apple');
  }

  // ---- Deezer ----
  if (['deezer.page.link', 'link.deezer.com', 'dzr.page.link'].includes(host)) return plain('deezer', 'link', { short: true });
  if (host === 'deezer.com') {
    const i = parts.findIndex((p) => ['playlist', 'album', 'track', 'artist', 'show', 'episode'].includes(p));
    const id = i >= 0 ? parts[i + 1] ?? '' : '';
    if (/^\d+$/.test(id)) {
      const type = parts[i];
      const canEmbed = ['playlist', 'album', 'track', 'artist'].includes(type);
      return {
        platform: 'deezer', kind: type, id, short: false,
        url: `https://www.deezer.com/${type}/${id}`,
        embed: canEmbed ? { src: `https://widget.deezer.com/widget/dark/${type}/${id}`, height: type === 'track' ? 150 : 380 } : null,
      };
    }
    return plain('deezer');
  }

  // ---- TIDAL ----
  if (host === 'tidal.com' || host === 'listen.tidal.com') {
    const i = parts.findIndex((p) => ['playlist', 'album', 'track', 'video', 'artist', 'mix'].includes(p));
    if (i >= 0 && parts[i + 1]) {
      const type = parts[i];
      return plain('tidal', type, { id: parts[i + 1], url: `https://tidal.com/browse/${type}/${parts[i + 1]}` });
    }
    return plain('tidal');
  }

  // ---- JOOX ----
  if (host === 'joox.com' || host.endsWith('.joox.com')) {
    const kind = parts.includes('playlist') ? 'playlist' : parts.includes('album') ? 'album'
      : parts.includes('single') ? 'track' : parts.includes('artist') ? 'artist' : 'link';
    return plain('joox', kind, { url: cleanHref() });
  }

  // ---- Amazon Music ----
  if (/^music\.amazon\./.test(host)) {
    const map = { playlists: 'playlist', 'user-playlists': 'playlist', albums: 'album', artists: 'artist', tracks: 'track' };
    return plain('amazon', map[parts[0]] ?? 'link', { url: cleanHref() });
  }

  // ---- Bandcamp ----
  if (host.endsWith('.bandcamp.com')) {
    const kind = parts[0] === 'album' ? 'album' : parts[0] === 'track' ? 'track' : 'profile';
    return plain('bandcamp', kind, { url: cleanHref() || u.origin });
  }

  // ---- Lain-lain: simpan link, buang parameter tracking ----
  for (const key of [...q.keys()]) if (/^(?:utm_|fbclid$|gclid$|si$)/i.test(key)) q.delete(key);
  return plain('other', 'link', { url: u.href });
}

/** Cari semua link dalam teks (satu baris satu link, atau bercampur dengan ayat). Dah dibuang yang sama. */
export function extractLinks(text) {
  const spaced = String(text ?? '').replace(/(\S)(https?:\/\/)/gi, '$1 $2');
  const found = spaced.match(/https?:\/\/[^\s<>"'`]+|spotify:(?:user:[^:\s]+:)?(?:playlist|album|track|artist|show|episode):[A-Za-z0-9]{22}/gi) ?? [];
  const seen = new Set();
  const out = [];
  for (const raw of found) {
    const link = raw.replace(/[),.;!?\]}>]+$/, '');
    const info = parseLink(link);
    if (info && !seen.has(info.url)) {
      seen.add(info.url);
      out.push(link);
    }
  }
  return out;
}
