# DYNOZ PLAYLIST

Rak peribadi untuk semua playlist aku: Spotify, YouTube, YouTube Music, SoundCloud, Apple Music, Deezer, JOOX, TIDAL dan link lain, semua dalam satu tempat. Boleh juga **cari lagu dan bina playlist sendiri** terus dalam app. Setiap playlist disimpan macam piring hitam dalam kulitnya, siap dengan nombor katalog (`DNZ-001`, `DNZ-002`, …).

## Cara buka

1. Pastikan **Node.js** dah ada (versi 18 ke atas). Semak dengan `node --version`.
2. Double-click **`START.bat`**. Browser akan buka **http://localhost:7070** sendiri.
   - Atau guna terminal: `npm start`
3. Untuk tutup, tutup tetingkap hitam tu (atau tekan `Ctrl+C`).

Tak perlu `npm install`. App ni tak guna sebarang package luar.

## Apa yang boleh buat

- **Tampal link, siap.** Tajuk dan cover diambil sendiri dari Spotify, YouTube, SoundCloud, Apple Music dan Deezer.
- **Tampal banyak link sekali gus.** Letak satu link satu baris, lepas tu tampal dalam kotak link.
- **Main terus dalam app** untuk Spotify, YouTube, YouTube Music, SoundCloud, Apple Music dan Deezer. Platform lain dibuka kat app asal.
- **Tag** (chill, gaming, jiwang, …), **kegemaran**, **carian**, dan **susunan**: terbaru, terakhir dimainkan, paling kerap dimainkan, A–Z, no. katalog.
- **Kulit auto** untuk playlist yang tiada gambar, atau muat naik gambar sendiri.
- **Eksport / import backup** (`.json`) dari menu ☰.
- **Tema** Auto / Gelap / Cerah.
- **Buka dalam banyak tab (atau PC + phone) serentak.** Perubahan dari setiap tab digabung, bukan saling menimpa.

> Spotify dan Apple Music cuma bagi preview 30 saat kalau kau belum login dalam browser. Login sekali kat open.spotify.com untuk dengar lagu penuh.

## Cari lagu & buat playlist sendiri

1. Tekan tab **Cari lagu** (kat phone: bar bawah).
2. Taip nama lagu atau artis. Hasil datang dari YouTube, jadi lagu dimainkan **penuh**.
3. Tekan **▶** untuk dengar dulu, tekan **+** untuk masukkan lagu ke playlist.
   - Kali pertama tekan **+**, app akan minta nama playlist baru.
   - Kotak **"Butang + masukkan lagu ke"** kat atas tunjuk playlist mana yang terima lagu. Klik untuk tukar atau buat playlist baru.
   - Tekan **✓** sekali lagi untuk buang lagu tu dari playlist.
4. Playlist buatan sendiri muncul dalam rak dengan kulit mozek dari lagu-lagunya. Klik untuk main semua lagu berturutan.
   - Kawalan: lagu sebelum / jeda / seterusnya, **main rawak** dan **ulang playlist**.
   - Butang **⋯** pada setiap lagu: naik, turun, buang, atau buka di YouTube.
   - **Buka di YouTube** buka semua lagu (sampai 50) sebagai satu senarai main kat YouTube.

Ada video yang pemiliknya tak benarkan dimainkan di laman lain. Lagu macam tu ditanda *tak boleh main dalam app* dan dilangkau sendiri.

### Carian lebih stabil dengan YouTube API key (pilihan)

Tanpa setup, carian baca halaman carian awam YouTube. Cara ni jalan, tapi bukan cara rasmi, dan boleh berhenti berfungsi kalau YouTube ubah halaman dia. Untuk cara rasmi (percuma, lebih kurang 100 carian sehari):

1. Pergi [console.cloud.google.com](https://console.cloud.google.com/), buat projek baru.
2. *APIs & Services → Library* → hidupkan **YouTube Data API v3**.
3. *APIs & Services → Credentials → Create credentials → API key*. Salin key tu.
4. Buka `START.bat` dengan Notepad, tambah baris ni **sebelum** baris `node server.js --open`:

   ```
   set YOUTUBE_API_KEY=key-kau-kat-sini
   ```

Tetingkap hitam akan tulis `Carian : YouTube (API rasmi)` bila key digunakan. Kalau kuota habis, app tukar balik ke cara tanpa key buat sementara.

## Mana data disimpan

Semua playlist disimpan dalam **`data/playlists.json`**, fail teks biasa dalam folder projek ni. Folder ni ada dalam OneDrive, jadi fail tu ikut di-backup ke cloud. Server juga simpan `data/playlists.backup.json`, salinan lama sikit (dikemas kini paling kerap sekali setiap 10 minit), kalau-kalau ada yang terpadam.

Kali pertama buka, rak diisi 6 playlist **CONTOH**. Buang dengan butang *Buang contoh* bila dah tak perlu.

## Shortcut papan kekunci

| Kekunci | Fungsi |
| --- | --- |
| `/` | Cari (dalam rak, atau lagu bila dalam tab *Cari lagu*) |
| `N` | Tambah playlist |
| `Enter` | Cari lagu terus (dalam tab *Cari lagu*) |
| `Esc` | Kosongkan carian / tutup dialog / kecilkan pemain |

## Buka dari phone (WiFi yang sama)

```
npm run lan
```

Terminal akan tunjuk alamat macam `http://192.168.1.5:7070`. Buka alamat tu kat phone. Hati-hati: sesiapa dalam WiFi yang sama boleh buka dan ubah playlist bila mod ni hidup.

## Tukar port

Kalau port 7070 dah dipakai program lain (cmd):

```
set PORT=7171 && npm start
```

## Susunan fail

```
server.js                server kecil: hidang webapp, simpan data, ambil info playlist
youtube-search.js        carian lagu YouTube (dengan atau tanpa API key)
START.bat                double-click untuk mula
public/index.html        struktur halaman
public/css/styles.css    rupa (warna, taip, susun atur)
public/js/app.js         logik UI
public/js/player.js      pemain lagu YouTube untuk playlist buatan sendiri
public/js/platforms.js   kenal pasti platform & link embed (tambah platform baru kat sini)
public/js/store.js       simpan ke fail (atau browser kalau tiada server)
public/js/seed.js        playlist contoh
data/playlists.json      data kau (dicipta sendiri)
```
