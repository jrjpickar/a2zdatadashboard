// Starts the background sync (it does the slow GHL/Twilio paging, up to 15 minutes).
export async function triggerBackgroundSync(env = process.env, fetchImpl = fetch) {
  const base = env.URL || env.DEPLOY_PRIME_URL || '';
  if (!base) throw new Error('Site URL unknown (URL env var).');
  if (!env.SYNC_SECRET) throw new Error('SYNC_SECRET is not set in Netlify.');
  const res = await fetchImpl(`${base}/.netlify/functions/sync-background`, { method: 'POST', headers: { 'x-sync-secret': env.SYNC_SECRET } });
  if (res.status !== 202 && !res.ok) throw new Error(`Background sync did not start (HTTP ${res.status})`);
  return true;
}
