// Kata laluan untuk app. Lepas log masuk, pelayar simpan cookie bertandatangan (HMAC),
// jadi server tak perlu simpan senarai sesi. Tukar kata laluan = semua sesi lama terus terbatal.
// Guna Web Crypto supaya jalan di Node dan Cloudflare Workers.

const COOKIE = 'dp_session';
const DAYS = 90;
const enc = new TextEncoder();

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(password, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`dynoz-playlist:${password}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

// Banding tanpa bocor masa (panjang sama sebab dua-dua hasil HMAC)
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function passwordOk(input, password) {
  if (!password || typeof input !== 'string') return false;
  const [a, b] = await Promise.all([sign(password, input), sign(password, password)]);
  return sameText(a, b);
}

export async function makeCookie(password, secure) {
  const exp = String(Date.now() + DAYS * 86_400_000);
  const token = `${exp}.${await sign(password, exp)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86_400}${secure ? '; Secure' : ''}`;
}

export const clearCookie = (secure) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export async function hasSession(request, password) {
  const cookie = request.headers.get('cookie') ?? '';
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return sameText(sig, await sign(password, exp));
}
