// Sign-in, the same way the dispatch board and the Ledger do it: inside GHL the
// page is a Custom Page of A2Z's private Marketplace app, asks GHL for the user
// (REQUEST_USER_DATA), and the server decrypts GHL's answer with the app's
// Shared Secret. Outside GHL, an optional DASHBOARD_PIN + GHL email works, but
// PIN sessions never get owner rights (the PIN is shared).
//
// Owners (jesse@a2zcs.net always, plus DASHBOARD_OWNERS) see Money and Settings.
// DASHBOARD_VIEWERS limits who else can open it; blank = any user in the location.
import { createHmac, createHash, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.mjs';
import { config } from './config.mjs';

export const SESSION_HEADER = 'x-kpi-session';
export const SESSION_COOKIE = 'a2z_kpi';
const TTL = 7 * 24 * 3600;

function secret(cfg) {
  if (!cfg.sessionSecret) throw new HttpError('SESSION_SECRET is not set in Netlify.', 500);
  return cfg.sessionSecret;
}
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const sign = (body, cfg) => createHmac('sha256', 'kpi:' + secret(cfg)).update(body).digest('base64url');
export function equal(a, b) { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return y.length > 0 && x.length === y.length && timingSafeEqual(x, y); }

export function signSession(user, via, cfg = config()) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ uid: user.id, name: user.name, email: String(user.email || '').toLowerCase(), via, iat: now, exp: now + TTL });
  return `${body}.${sign(body, cfg)}`;
}
export function verifySession(token, cfg = config()) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  let expected; try { expected = sign(body, cfg); } catch { return null; }
  if (!equal(sig, expected)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p?.uid || !p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
  return p;
}
function cookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return '';
}
export const sessionCookie = token => `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=None; Partitioned`;

export function roleFor(session, cfg = config()) {
  if (!session) return null;
  const email = String(session.email || '').toLowerCase();
  const owner = session.via === 'ghl_sso' && cfg.owners.includes(email);
  return { ...session, owner };
}
export function allowed(email, cfg = config()) {
  const e = String(email || '').toLowerCase();
  return cfg.owners.includes(e) || !cfg.viewers.length || cfg.viewers.includes(e);
}
export function requireSession(request, cfg = config()) {
  const s = verifySession(request.headers.get(SESSION_HEADER) || cookie(request, SESSION_COOKIE), cfg);
  if (!s) throw new HttpError('Sign in again (open the dashboard from GHL).', 401);
  if (!allowed(s.email, cfg)) throw new HttpError('You are not on the dashboard viewer list.', 403);
  return roleFor(s, cfg);
}
export function requireOwner(request, cfg = config()) {
  const s = requireSession(request, cfg);
  if (!s.owner) throw new HttpError('Owner access required (signed in through GHL).', 403);
  return s;
}

// GHL Custom Page user context: CryptoJS AES ("Salted__" + OpenSSL EVP key derivation).
export function decryptGhlUserData(encrypted, passphrase) {
  const raw = Buffer.from(String(encrypted || ''), 'base64');
  if (raw.length < 17 || raw.subarray(0, 8).toString('ascii') !== 'Salted__') throw new Error('Invalid encrypted context');
  const salt = raw.subarray(8, 16), password = Buffer.from(passphrase), blocks = [];
  let prev = Buffer.alloc(0);
  while (Buffer.concat(blocks).length < 48) { prev = createHash('md5').update(Buffer.concat([prev, password, salt])).digest(); blocks.push(prev); }
  const m = Buffer.concat(blocks);
  const d = createDecipheriv('aes-256-cbc', m.subarray(0, 32), m.subarray(32, 48));
  return Buffer.concat([d.update(raw.subarray(16)), d.final()]).toString('utf8');
}
export function ghlUserFromContext(encrypted, cfg = config()) {
  if (!cfg.appSharedSecret) throw new HttpError('GHL_APP_SHARED_SECRET is not set, so GHL sign-in is off.', 503);
  if (typeof encrypted !== 'string' || !encrypted || encrypted.length > 20000) throw new HttpError('Encrypted GHL user context is required.');
  let user;
  try { user = JSON.parse(decryptGhlUserData(encrypted, cfg.appSharedSecret)); }
  catch { throw new HttpError('GHL user context could not be verified. Check GHL_APP_SHARED_SECRET.', 401); }
  if (!user?.userId || !user.email) throw new HttpError('GHL user context is incomplete.', 401);
  if (user.activeLocation !== cfg.locationId) throw new HttpError('This GHL user is not in the A2Z location.', 403);
  return { id: String(user.userId), name: String(user.userName || user.email), email: String(user.email).toLowerCase() };
}
