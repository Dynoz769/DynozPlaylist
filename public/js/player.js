// Pemain lagu untuk playlist buatan sendiri & carian lagu.
// Guna YouTube IFrame Player API rasmi: https://developers.google.com/youtube/iframe_api_reference

export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

// Kod ralat YouTube → maksud ringkas
export const YT_ERRORS = {
  2: 'ID video tak sah',
  5: 'pemain tak dapat main video ni',
  100: 'video dah dipadam atau dijadikan peribadi',
  101: 'pemilik video tak benarkan ia dimainkan di laman lain',
  150: 'pemilik video tak benarkan ia dimainkan di laman lain',
  153: 'YouTube perlukan app dibuka melalui http://localhost',
};

let apiPromise = null;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      script.remove();
      reject(new Error('Tak dapat muat pemain YouTube. Semak sambungan internet.'));
    };
    document.head.append(script);
  });
  return apiPromise;
}

export class SongPlayer {
  #player = null;
  #iframe = null;
  #mounting = null;
  #gen = 0;
  #current = null;
  #wanted = null;

  constructor({ onState = () => {}, onEnded = () => {}, onError = () => {} } = {}) {
    this.onState = onState;
    this.onEnded = onEnded;
    this.onError = onError;
  }

  /** Main `videoId` dalam `slot`. Pemain dicipta sekali, lepas tu cuma tukar video. */
  async play(slot, videoId) {
    this.#wanted = videoId;
    if (this.#iframe && !slot.contains(this.#iframe)) this.destroy();
    this.#mounting ??= this.#mount(slot, videoId).catch((err) => {
      this.#mounting = null;
      throw err;
    });
    await this.#mounting;
    if (!this.#player || this.#current === this.#wanted) return;
    this.#current = this.#wanted;
    this.#player.loadVideoById(this.#wanted);
  }

  async #mount(slot, videoId) {
    const gen = ++this.#gen;
    const YT = await loadApi();
    if (gen !== this.#gen) return;
    const host = document.createElement('div');
    slot.replaceChildren(host);
    this.#current = videoId;
    await new Promise((resolve) => {
      const player = new YT.Player(host, {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => {
            if (gen !== this.#gen) {
              player.destroy();
            } else {
              this.#player = player;
              this.#iframe = player.getIframe();
            }
            resolve();
          },
          onStateChange: (e) => {
            if (gen !== this.#gen) return;
            this.onState(e.data);
            if (e.data === YT_STATE.ENDED) this.onEnded();
          },
          onError: (e) => {
            if (gen === this.#gen) this.onError(e.data);
          },
        },
      });
    });
  }

  get ready() {
    return Boolean(this.#player);
  }

  isPlaying() {
    const s = this.#player?.getPlayerState?.();
    return s === YT_STATE.PLAYING || s === YT_STATE.BUFFERING;
  }

  toggle() {
    if (!this.#player) return;
    if (this.isPlaying()) this.#player.pauseVideo();
    else this.#player.playVideo();
  }

  pause() {
    this.#player?.pauseVideo?.();
  }

  /** Saat semasa dalam lagu (0 kalau belum sedia). */
  time() {
    return this.#player?.getCurrentTime?.() ?? 0;
  }

  restart() {
    this.#player?.seekTo?.(0, true);
    this.#player?.playVideo?.();
  }

  destroy() {
    this.#gen += 1;
    try {
      this.#player?.destroy();
    } catch {}
    this.#player = null;
    this.#iframe = null;
    this.#mounting = null;
    this.#current = null;
  }
}
