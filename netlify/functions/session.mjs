// POST /api/session { action: "ghl", encryptedData } | { action: "pin", email, pin }
// GET  /api/session -> who is signed in
import { json, errorResponse, readJson, sameOrigin, HttpError } from '../../lib/http.mjs';
import { config } from '../../lib/config.mjs';
import { signSession, sessionCookie, ghlUserFromContext, requireSession, allowed, equal } from '../../lib/auth.mjs';

const fails = new Map();
export default async function handler(request) {
  try {
    const cfg = config();
    if (request.method === 'GET') {
      const s = requireSession(request, cfg);
      return json({ user: { name: s.name, email: s.email }, owner: s.owner, via: s.via, pinAvailable: !!cfg.pin });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    sameOrigin(request);
    const body = await readJson(request);
    let user, via;
    if (body.action === 'ghl') { user = ghlUserFromContext(body.encryptedData, cfg); via = 'ghl_sso'; }
    else if (body.action === 'pin') {
      if (!cfg.pin) throw new HttpError('PIN sign-in is off. Open the dashboard from GHL.', 403);
      const ip = request.headers.get('x-nf-client-connection-ip') || 'ip';
      const f = fails.get(ip) || { n: 0, at: 0 };
      if (f.n >= 5 && Date.now() - f.at < 15 * 60000) throw new HttpError('Too many tries. Wait 15 minutes.', 429);
      const email = String(body.email || '').trim().toLowerCase();
      if (!equal(String(body.pin || ''), cfg.pin) || !/^[^@\s]+@[^@\s]+$/.test(email)) { fails.set(ip, { n: f.n + 1, at: Date.now() }); throw new HttpError('Email or PIN is wrong.', 401); }
      fails.delete(ip);
      user = { id: 'pin:' + email, name: email, email }; via = 'pin';
    } else throw new HttpError('Unknown sign-in action');
    if (!allowed(user.email, cfg)) throw new HttpError(`${user.email} is not on the dashboard viewer list (DASHBOARD_VIEWERS).`, 403);
    const token = signSession(user, via, cfg);
    return json({ token, user: { name: user.name, email: user.email }, owner: via === 'ghl_sso' && cfg.owners.includes(user.email) }, 200, { 'set-cookie': sessionCookie(token) });
  } catch (error) { return errorResponse(error); }
}
