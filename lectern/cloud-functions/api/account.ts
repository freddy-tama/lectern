// EdgeOne Makers Cloud Function for /api/account: runs api/account.ts (see server/edgeone.ts).
import { type CloudContext, fromCloud } from '../../server/edgeone.js';

export default function onRequest(context: CloudContext): Promise<Response> {
  return fromCloud('account', context);
}
