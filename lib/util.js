// Pembantu kecil yang dikongsi server.js (Node) dan worker.js (Cloudflare).
// Guna Web API standard sahaja (fetch, TextDecoder, ...) supaya jalan kat kedua-duanya.

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

export function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s ?? '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return named[code.toLowerCase()] ?? m;
  });
}

// Baca badan respons sampai `limit` bait sahaja — halaman web boleh jadi sangat besar.
export async function readLimited(res, limit) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (size >= limit) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  return text + decoder.decode();
}
