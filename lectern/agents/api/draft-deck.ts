// EdgeOne Makers Agents function for /api/draft-deck: runs api/draft-deck.ts with up to 300 s (see server/edgeone.ts).
import { type AgentContext, fromAgent } from '../../server/edgeone.js';

export async function onRequest(context: AgentContext): Promise<Response> {
  return fromAgent('draft-deck', context);
}
