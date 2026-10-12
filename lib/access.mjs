// Who can open the dashboard, like the dispatch board:
//   Senior admin - jesse@a2zcs.net always (built in) + DASHBOARD_OWNERS. Can't be removed.
//                  The only role that can make or remove admins.
//   Admin        - added on the Users tab by a senior admin. Sees Money + Settings,
//                  adds and removes viewers.
//   Viewer       - added on the Users tab. Everything except Money, Settings, Users.
// Anyone else is refused (and listed under "Asked for access" so an admin can add them).
// Admin rights need a GHL sign-in; a PIN sign-in is always viewer level.
import { kpiStore, KEYS } from './store.mjs';
import { HttpError } from './http.mjs';

export const ROLES = ['viewer', 'admin'];
let cache = { at: 0, data: null };
const norm = v => String(v || '').trim().toLowerCase();

export async function readAccess(store = kpiStore(), { fresh = false } = {}) {
  if (!fresh && cache.data && Date.now() - cache.at < 20000) return cache.data;
  const data = (await store.get(KEYS.access, { type: 'json' })) || { users: [], requests: [] };
  data.users ||= []; data.requests ||= [];
  cache = { at: Date.now(), data };
  return data;
}
export async function writeAccess(store, data) { await store.setJSON(KEYS.access, data); cache = { at: Date.now(), data }; }
export const _resetAccessCache = () => { cache = { at: 0, data: null }; };

// Role for a verified session: 'senior' | 'admin' | 'viewer' | null.
export function roleOf(session, access, cfg) {
  const email = norm(session?.email);
  if (!email) return null;
  const trusted = session.via === 'ghl_sso';
  if (cfg.owners.includes(email)) return trusted ? 'senior' : 'viewer';
  const entry = access.users.find(u => norm(u.email) === email);
  if (entry) return entry.role === 'admin' && trusted ? 'admin' : 'viewer';
  if (cfg.viewers.includes(email)) return 'viewer';
  return null;
}
export const isAdmin = role => role === 'admin' || role === 'senior';

export async function noteRequest(store, user) {
  const data = await readAccess(store, { fresh: true });
  const email = norm(user.email);
  data.requests = [{ email, name: user.name || email, at: new Date().toISOString() }, ...data.requests.filter(r => norm(r.email) !== email)].slice(0, 50);
  await writeAccess(store, data);
}

// Apply an add / remove / role change from the Users tab.
export function applyChange(data, change, actor, cfg) {
  const email = norm(change.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError('Enter a valid email.');
  if (cfg.owners.includes(email)) throw new HttpError('Senior admins are set in Netlify (DASHBOARD_OWNERS) and can\'t be changed here.', 409);
  const existing = data.users.find(u => norm(u.email) === email);
  const touchesAdmin = existing?.role === 'admin' || change.role === 'admin';
  if (touchesAdmin && actor.role !== 'senior') throw new HttpError('Only a senior admin can add, change or remove admins.', 403);
  const now = new Date().toISOString();
  if (change.action === 'add' || change.action === 'set_role') {
    const role = ROLES.includes(change.role) ? change.role : 'viewer';
    if (existing) Object.assign(existing, { role, name: String(change.name || existing.name || email).slice(0, 120), changedBy: actor.name, changedAt: now });
    else if (change.action === 'add') data.users.push({ email, name: String(change.name || email).slice(0, 120), role, addedBy: actor.name, addedAt: now });
    else throw new HttpError('That person is not on the list.', 404);
    data.requests = data.requests.filter(r => norm(r.email) !== email);
  } else if (change.action === 'remove') {
    if (!existing) throw new HttpError('That person is not on the list.', 404);
    data.users = data.users.filter(u => u !== existing);
  } else if (change.action === 'dismiss_request') {
    data.requests = data.requests.filter(r => norm(r.email) !== email);
  } else throw new HttpError('Unknown action');
  data.users.sort((a, b) => a.name.localeCompare(b.name));
  data.log = [{ at: now, by: actor.name, action: change.action, email, role: change.role || '' }, ...(data.log || [])].slice(0, 300);
  return data;
}
