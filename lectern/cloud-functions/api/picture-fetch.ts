// EdgeOne Makers Cloud Function for /api/picture-fetch: runs api/picture-fetch.ts (see server/edgeone.ts).
import { type CloudContext, fromCloud } from '../../server/edgeone.js';

export default function onRequest(context: CloudContext): Promise<Response> {
  return fromCloud('picture-fetch', context);
}
