// EdgeOne Makers Cloud Function for /api/deck-questions: runs api/deck-questions.ts (see server/edgeone.ts).
import { type CloudContext, fromCloud } from '../../server/edgeone.js';

export default function onRequest(context: CloudContext): Promise<Response> {
  return fromCloud('deck-questions', context);
}
