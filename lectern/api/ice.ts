// Vercel function: relay (TURN) details for Share to phones.
// GET /api/ice → { iceServers, ttl, relay }
//
// Phones on school or guest Wi-Fi, and many on mobile data, can't reach the presenter's
// computer directly; only a relay gets through. Set one of these and every phone and
// computer that shares picks it up, with no new build. With neither, iceServers is empty
// and the browser keeps its public defaults (src/features/share/peer.ts).
//
// Environment (all optional):
//   CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN   Cloudflare's TURN service: short-lived
//                                                       passwords are made for each visitor
//   TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL           any other TURN server, with fixed
//                                                       details; TURN_URLS is comma separated,
//                                                       like "turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp"
//
// Relay details have to reach the browser to be used, so this is open to anyone, like the app.

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** How long Cloudflare's passwords last. They are kept for half of that. */
const TTL = 24 * 60 * 60;

let cached: { until: number; servers: IceServer[] } | null = null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const ICE_URL = /^(stun|stuns|turn|turns):[^\s,]+$/;

/**
 * Tidies servers from a provider or the settings: valid addresses only, and none on port 53,
 * which browsers wait on until they give up.
 */
export function cleanServers(raw: unknown): IceServer[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return list.flatMap((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const urls = (Array.isArray(o.urls) ? o.urls : [o.urls])
      .filter((u): u is string => typeof u === 'string' && ICE_URL.test(u.trim()))
      .map((u) => u.trim())
      .filter((u) => !/:53(\?|$)/.test(u));
    if (!urls.length) return [];
    const relay = urls.some((u) => u.startsWith('turn'));
    if (relay && (typeof o.username !== 'string' || typeof o.credential !== 'string')) return [];
    return [{ urls, ...(relay ? { username: o.username as string, credential: o.credential as string } : {}) }];
  });
}

/** A fixed relay from TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL. */
export function staticServers(env: Record<string, string | undefined>): IceServer[] {
  const urls = (env.TURN_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls.length) return [];
  return cleanServers({ urls, username: env.TURN_USERNAME ?? '', credential: env.TURN_CREDENTIAL ?? '' });
}

async function cloudflareServers(keyId: string, token: string, fetcher: typeof fetch): Promise<IceServer[]> {
  const res = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl: TTL }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Cloudflare TURN answered ${res.status}`);
  const body = (await res.json()) as { iceServers?: unknown };
  return cleanServers(body.iceServers);
}

/** The relay servers from the settings, made fresh when they are about to expire. */
export async function relayServers(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<IceServer[]> {
  if (cached && now < cached.until) return cached.servers;
  let servers: IceServer[] = [];
  if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) {
    try {
      servers = await cloudflareServers(env.CLOUDFLARE_TURN_KEY_ID, env.CLOUDFLARE_TURN_API_TOKEN, fetcher);
    } catch {
      // Fall back to a fixed relay, if there is one, and ask Cloudflare again soon.
      servers = staticServers(env);
      cached = { until: now + 60_000, servers };
      return servers;
    }
  }
  if (!servers.length) servers = staticServers(env);
  cached = { until: now + (TTL * 1000) / 2, servers };
  return servers;
}

/** Forgets the servers made so far. For tests. */
export function resetRelayCache() {
  cached = null;
}

export async function GET() {
  const servers = await relayServers();
  return json({ iceServers: servers, ttl: TTL / 2, relay: servers.some((s) => s.urls.some((u) => u.startsWith('turn'))) });
}
