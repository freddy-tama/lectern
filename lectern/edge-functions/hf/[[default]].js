// EdgeOne Makers edge function: forwards /hf/<model>/resolve/main/<file> to Hugging Face.
// huggingface.co is blocked in mainland China, so the transcription worker falls back to this
// address on Lectern's own site (src/core/transcribe/model-hosts.ts). The edge node fetches the
// file from outside the mainland and streams it on. See docs/china-hosting.md.
//
// Only the Whisper models Lectern offers pass, so this isn't an open proxy. Plain JavaScript:
// Makers edge functions don't take TypeScript.

const UPSTREAM = 'https://huggingface.co/';
const ALLOWED = /^onnx-community\/whisper-[a-z0-9.-]+\/resolve\/main\/[A-Za-z0-9._/-]+$/;
const KEEP = ['content-type', 'etag', 'last-modified', 'accept-ranges', 'content-range'];

/** The Hugging Face address for a path on this site, or null when it isn't one of the models. */
export function upstreamUrl(pathname) {
  const path = String(pathname).replace(/^\/hf\//, '');
  if (!ALLOWED.test(path) || path.split('/').some((part) => part === '..' || part === '.')) return null;
  return UPSTREAM + path;
}

/** The headers to pass on. The length only when the body arrives as sent, not decompressed. */
export function passedHeaders(upstream) {
  const out = new Headers();
  for (const key of KEEP) {
    const value = upstream.headers.get(key);
    if (value) out.set(key, value);
  }
  const length = upstream.headers.get('content-length');
  if (length && !upstream.headers.get('content-encoding')) out.set('content-length', length);
  out.set('cache-control', upstream.ok ? 'public, max-age=86400' : 'no-store');
  return out;
}

export async function forward(request, fetcher = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const target = upstreamUrl(new URL(request.url).pathname);
  if (!target) return new Response('Not found', { status: 404 });
  const headers = {};
  const range = request.headers.get('range');
  if (range) headers.range = range;
  try {
    const upstream = await fetcher(target, { method: request.method, headers, redirect: 'follow' });
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: passedHeaders(upstream) });
  } catch {
    return new Response('Hugging Face could not be reached', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}

export default function onRequest(context) {
  return forward(context.request);
}
