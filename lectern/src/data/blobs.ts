// Turning stored files into text and back, for deck files and backups.
// Works without FileReader so it runs the same in tests.

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/** A Blob from a data URL, or null when the text isn't one. */
export function dataUrlToBlob(data: string, fallbackType = 'application/octet-stream'): Blob | null {
  const match = /^data:([^,]*?),/i.exec(data);
  if (!match) return null;
  const params = match[1].split(';');
  const type = params[0] || fallbackType;
  const body = data.slice(match[0].length);
  try {
    if (params.slice(1).some((p) => p.toLowerCase() === 'base64')) {
      const bin = atob(body.replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(body)], { type });
  } catch {
    return null;
  }
}

/** Every "asset:<id>" reference inside a value, in the order found. */
export function assetRefs(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith('asset:')) found.add(value.slice(6));
  } else if (Array.isArray(value)) {
    for (const v of value) assetRefs(v, found);
  } else if (value && typeof value === 'object' && !(value instanceof Blob)) {
    for (const v of Object.values(value)) assetRefs(v, found);
  }
  return found;
}

/** A copy of a value with "asset:<old>" references pointed at new ids. */
export function renameAssets<T>(value: T, ids: Map<string, string>): T {
  if (!ids.size) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith('asset:') && ids.has(v.slice(6)) ? `asset:${ids.get(v.slice(6))}` : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Blob)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
