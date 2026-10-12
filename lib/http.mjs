export class HttpError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export function errorResponse(error) {
  if (!(error instanceof HttpError)) console.error(error);
  return json({ error: error instanceof HttpError ? error.message : 'Something went wrong. Try again.' }, error.status || 500);
}
export async function readJson(request, limit = 64 * 1024) {
  const text = await request.text();
  if (Buffer.byteLength(text) > limit) throw new HttpError('Payload too large', 413);
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError('Request body must be JSON'); }
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError('Cross-site request refused', 403);
}
