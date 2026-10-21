// Vercel function: whether this server has accounts, how the browser signs in, and a person's AI credits.
// GET /api/account                          → { accounts: false }, or { accounts: true, url, key, startCredits, github, email, signedIn: false }
// GET /api/account (Authorization: Bearer)  → the same with { signedIn: true, credits }; the first call opens the account
//
// `url` and `key` are the Supabase project's address and its public (publishable) key, which browsers
// are meant to have. The secret key never leaves the server.
//
// Environment: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) and SUPABASE_SECRET_KEY
// (or SUPABASE_SERVICE_ROLE_KEY), as in api/_lib/account.ts.

import { START_CREDITS } from '../src/core/ai/prices.js';
import { bearer, creditStatus, signInMethods, supabaseSettings, userFor } from './_lib/account.js';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function GET(request: Request) {
  const settings = supabaseSettings();
  if (!settings) return json({ accounts: false });
  const token = bearer(request);
  const config = { accounts: true, url: settings.url, key: settings.publicKey, startCredits: START_CREDITS, ...(token ? {} : await signInMethods(settings)) };
  if (!token) return json({ ...config, signedIn: false });
  try {
    const user = await userFor(settings, token);
    if (!user) return json({ ...config, signedIn: false });
    const { balance } = await creditStatus(settings, user.id);
    return json({ ...config, signedIn: true, credits: Math.round(balance * 1000) / 1000 });
  } catch (error) {
    console.error('Reading AI credits failed', error);
    return json({ ...config, error: 'Your AI credits couldn’t be read just now.' }, 503);
  }
}
