// EdgeOne Makers Agents function for /api/deck-assistant: runs api/deck-assistant.ts with up to 300 s (see server/edgeone.ts).
import { type AgentContext, fromAgent } from '../../server/edgeone.js';

export async function onRequest(context: AgentContext): Promise<Response> {
  return fromAgent('deck-assistant', context);
}
