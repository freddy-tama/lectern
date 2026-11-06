// EdgeOne Makers Cloud Function for /api/picture-search: runs api/picture-search.ts (see server/edgeone.ts).
import { type CloudContext, fromCloud } from '../../server/edgeone.js';

export default function onRequest(context: CloudContext): Promise<Response> {
  return fromCloud('picture-search', context);
}
