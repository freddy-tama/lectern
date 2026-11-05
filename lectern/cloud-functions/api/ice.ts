// EdgeOne Makers Cloud Function for /api/ice: runs api/ice.ts (see server/edgeone.ts).
import { type CloudContext, fromCloud } from '../../server/edgeone.js';

export default function onRequest(context: CloudContext): Promise<Response> {
  return fromCloud('ice', context);
}
