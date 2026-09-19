// Playlist contoh untuk kali pertama app dibuka.
// Semua ditanda `sample: true` (nombor DEMO-xxx) supaya boleh dibuang sekali klik,
// dan nombor katalog DNZ-001 kekal untuk playlist pertama kau sendiri.

const ROWS = [
  {
    title: 'Today’s Hits',
    url: 'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb',
    platform: 'apple', kind: 'playlist', author: 'Apple Music',
    cover: 'https://is1-ssl.mzstatic.com/image/thumb/Features/v4/f3/75/4e/f3754e7b-ac9d-12ce-0b0a-fd9fa15efe1a/76ac6684-8406-4a23-aa00-96a97ebb6569.png/600x600cc.jpg',
    tags: ['carta', 'pop'],
    notes: 'Hits terkini versi Apple Music.',
  },
  {
    title: 'Chillhop Music',
    url: 'https://soundcloud.com/chillhopdotcom',
    platform: 'soundcloud', kind: 'profile', author: 'Chillhop Music',
    cover: 'https://i1.sndcdn.com/avatars-r4zK7WtA0FKek2eI-Sk9dKQ-t500x500.jpg',
    tags: ['chill'],
    notes: 'Beat santai, sesuai masa hujan.',
  },
  {
    title: 'phonk',
    url: 'https://open.spotify.com/playlist/37i9dQZF1DWWY64wDtewQt',
    platform: 'spotify', kind: 'playlist', author: 'Spotify',
    cover: 'https://i.scdn.co/image/ab67706f0000000371ff720f409999d89f09a8e4',
    tags: ['gaming', 'phonk'],
    notes: 'Bila nak rasa laju.',
  },
  {
    title: 'Study Sessions 📚 lofi music to focus to',
    url: 'https://www.youtube.com/playlist?list=PL6NdkXsPL07LBOz-XhgCJJGlI4jarMKzp',
    platform: 'youtube', kind: 'playlist', author: 'Lofi Girl',
    cover: 'https://i.ytimg.com/vi/lTRiuFIWV54/hqdefault.jpg',
    tags: ['chill', 'study'],
    notes: 'Lofi Girl. Pasang masa buat kerja.',
    favorite: true,
  },
  {
    title: 'Top Gaming Tracks',
    url: 'https://open.spotify.com/playlist/37i9dQZF1DWTyiBJ6yEqeu',
    platform: 'spotify', kind: 'playlist', author: 'Spotify',
    cover: 'https://i.scdn.co/image/ab67706f0000000322029b469518229b8d5dc282',
    tags: ['gaming', 'hype'],
    notes: 'Untuk sesi ranked malam-malam.',
    favorite: true,
  },
  {
    title: 'Top 50 - Malaysia',
    url: 'https://open.spotify.com/playlist/37i9dQZEVXbJlfUljuZExa',
    platform: 'spotify', kind: 'playlist', author: 'Spotify',
    cover: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_my_default.jpg',
    tags: ['carta', 'malaysia'],
    notes: 'Lagu paling banyak distream kat Malaysia. Bertukar setiap hari.',
  },
];

export function sampleData() {
  const now = Date.now();
  const playlists = ROWS.map((row, i) => {
    const at = new Date(now - (ROWS.length - i) * 3_600_000).toISOString();
    return {
      id: `contoh-${i + 1}`,
      no: i + 1,
      favorite: false,
      plays: 0,
      lastPlayedAt: null,
      createdAt: at,
      updatedAt: at,
      sample: true,
      ...row,
    };
  });
  return { version: 1, nextNo: 1, playlists };
}
