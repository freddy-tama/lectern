// Where the speech models download from. Hugging Face comes first. huggingface.co is blocked in
// mainland China, and the public mirrors there don't let other sites read their files, so a
// deployment for China can forward /hf/ on its own address to Hugging Face (see
// docs/china-hosting.md). The first host that serves the chosen model is used; a site without
// that forward answers /hf/ with its own page, which isn't a model config, so it's skipped.
//
// Build-time setting (optional):
//   VITE_MODEL_HOSTS   comma-separated hosts to try in order: https addresses, or paths on this
//                      site such as "/hf/". A build only for China can put "/hf/" first.

export const DEFAULT_MODEL_HOSTS = ['https://huggingface.co/', '/hf/'];

/**
 * The hosts to try, from the setting or the defaults, as full addresses ending in "/". Paths are
 * read against `base` (this site's address); without one they're left out.
 */
export function modelHosts(raw: string | undefined, base?: string): string[] {
  const given = (raw ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const list = (given.length ? given : DEFAULT_MODEL_HOSTS).flatMap((h) => {
    if (/^https:\/\/[^\s/]+(\/\S*)?$/.test(h)) return [h];
    if (/^\/[^\s/]\S*$/.test(h) && base) {
      try { return [new URL(h, base).href]; } catch { return []; }
    }
    return [];
  }).map((h) => (h.endsWith('/') ? h : `${h}/`));
  return list.length ? [...new Set(list)] : [DEFAULT_MODEL_HOSTS[0]!];
}

/** The address of a model's small config file on a host, the same path transformers.js reads. */
export function probeUrl(host: string, model: string): string {
  return `${host}${model}/resolve/main/config.json`;
}

/**
 * The first host that serves the model's config, as JSON, within the time limit. When none does,
 * the first host, so the download fails with that host's own error.
 */
export async function pickModelHost(
  hosts: string[],
  model: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<string> {
  if (hosts.length < 2) return hosts[0] ?? DEFAULT_MODEL_HOSTS[0]!;
  for (const host of hosts) {
    try {
      const res = await fetcher(probeUrl(host, model), { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const config: unknown = JSON.parse(await res.text());
      if (config && typeof config === 'object' && !Array.isArray(config)) return host;
    } catch {
      // Blocked, unreachable, too slow, or a web page instead of a config: try the next one.
    }
  }
  return hosts[0]!;
}
