// @vitest-environment node
// Runs supabase/schema.sql in a real Postgres (PGlite), with the parts of Supabase it relies on
// stood in for: the auth schema, auth.uid() and the anon / authenticated / service_role roles.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCHEMA = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const ADA = '11111111-1111-1111-1111-111111111111';
const BEN = '22222222-2222-2222-2222-222222222222';

const SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  -- What Supabase has long done for the public schema: open everything, and leave it to policies.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  insert into auth.users (id, email) values ('${ADA}', 'ada@example.com'), ('${BEN}', 'ben@example.com');
`;

let pg: PGlite;

/** Runs statements as a role, signed in as a user when one is given, then goes back to the owner. */
async function as<T>(role: 'service_role' | 'authenticated' | 'anon', user: string, run: () => Promise<T>): Promise<T> {
  await pg.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
  try {
    return await run();
  } finally {
    await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const one = async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0]!;
const status = (user: string) => one<{ balance: string; spent_today: string }>('select * from public.lectern_credit_status($1, 4000)', [user]);
const spend = (user: string, credits: number, endpoint = 'draft-deck') =>
  one<{ left: string }>('select public.lectern_spend($1, $2, $3, $4, 4000) as left', [user, credits, endpoint, JSON.stringify([{ model: 'claude-opus-5-5' }])]);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE);
  await pg.exec(SCHEMA);
}, 60_000);

afterAll(async () => { await pg?.close(); });

describe('supabase/schema.sql', () => {
  it('can be run again safely', async () => {
    await expect(pg.exec(SCHEMA)).resolves.toBeDefined();
  });

  it('opens an account with the starting credits once, and spends from it', async () => {
    await as('service_role', '', async () => {
      expect(Number((await status(ADA)).balance)).toBe(4000);
      expect(Number((await spend(ADA, 12.345)).left)).toBeCloseTo(3987.655);
      // Asking again doesn't top the account back up.
      expect(Number((await status(ADA)).balance)).toBeCloseTo(3987.655);
      expect(Number((await status(ADA)).spent_today)).toBeCloseTo(12.345);
    });
  });

  it('records each spend and adds it to the day', async () => {
    await as('service_role', '', async () => {
      // Spending opens the account too.
      expect(Number((await spend(BEN, 3999, 'picture-generate')).left)).toBe(1);
      // The last request may take the balance below zero; the server refuses the next one.
      expect(Number((await spend(BEN, 5)).left)).toBe(-4);
    });
    const events = await pg.query<{ endpoint: string; credits: string }>('select endpoint, credits from public.credit_events where user_id = $1 order by id', [BEN]);
    expect(events.rows.map((r) => [r.endpoint, Number(r.credits)])).toEqual([['picture-generate', 3999], ['draft-deck', 5]]);
    const day = await one<{ credits: string }>('select credits from public.credit_days');
    expect(Number(day.credits)).toBeCloseTo(12.345 + 3999 + 5);
  });

  it('refuses to spend a negative amount', async () => {
    await expect(as('service_role', '', () => spend(ADA, -10))).rejects.toThrow(/zero or more/);
  });

  it('lets no one but the server open accounts or spend credits', async () => {
    for (const role of ['authenticated', 'anon'] as const) {
      await expect(as(role, ADA, () => spend(ADA, -1000))).rejects.toThrow(/permission denied/);
      await expect(as(role, ADA, () => status(ADA))).rejects.toThrow(/permission denied/);
    }
    await expect(as('authenticated', ADA, () => pg.query('update public.credit_accounts set credits = 99999'))).resolves.toMatchObject({ affectedRows: 0 });
    await expect(as('authenticated', ADA, () => pg.query(`insert into public.credit_accounts (user_id, credits, granted) values ('${ADA}', 1e6, 1e6)`))).rejects.toThrow(/row-level security|duplicate/);
    expect(Number((await one<{ credits: string }>('select credits from public.credit_accounts where user_id = $1', [ADA])).credits)).toBeCloseTo(3987.655);
  });

  it('shows people their own balance and spending only', async () => {
    await as('authenticated', ADA, async () => {
      const accounts = await pg.query<{ user_id: string }>('select user_id from public.credit_accounts');
      expect(accounts.rows.map((r) => r.user_id)).toEqual([ADA]);
      const events = await pg.query<{ user_id: string }>('select user_id from public.credit_events');
      expect(new Set(events.rows.map((r) => r.user_id))).toEqual(new Set([ADA]));
      expect((await pg.query('select * from public.credit_days')).rows).toEqual([]);
    });
    await as('anon', '', async () => {
      expect((await pg.query('select * from public.credit_accounts')).rows).toEqual([]);
    });
  });

  it('keeps each person’s study marks to themselves', async () => {
    const mark = (deck: string, slide: string, state: string, at: number) =>
      pg.query('insert into public.study_marks (deck_id, slide_id, status, updated_at) values ($1, $2, $3, $4) on conflict (user_id, deck_id, slide_id) do update set status = excluded.status, updated_at = excluded.updated_at', [deck, slide, state, at]);
    await as('authenticated', ADA, async () => {
      await mark('deck_a', 's1', 'learning', 1);
      await mark('deck_a', 's1', 'known', 2);
      await mark('deck_a', 's2', 'learning', 3);
      await expect(mark('deck_a', 's3', 'forgotten', 4)).rejects.toThrow(/check constraint/);
      // Writing a mark into someone else's account is refused.
      await expect(pg.query(`insert into public.study_marks (user_id, deck_id, slide_id, status, updated_at) values ('${BEN}', 'deck_a', 's1', 'known', 5)`)).rejects.toThrow(/row-level security/);
    });
    await as('authenticated', BEN, async () => {
      await mark('deck_a', 's1', 'learning', 9);
      expect((await pg.query<{ status: string }>('select status from public.study_marks')).rows).toEqual([{ status: 'learning' }]);
      // Ben can't change or remove Ada's marks.
      expect((await pg.query(`update public.study_marks set status = 'learning' where user_id = '${ADA}'`)).affectedRows).toBe(0);
      expect((await pg.query(`delete from public.study_marks where user_id = '${ADA}'`)).affectedRows).toBe(0);
    });
    await as('authenticated', ADA, async () => {
      const rows = await pg.query<{ slide_id: string; status: string }>('select slide_id, status from public.study_marks order by slide_id');
      expect(rows.rows).toEqual([{ slide_id: 's1', status: 'known' }, { slide_id: 's2', status: 'learning' }]);
    });
    await as('anon', '', async () => {
      await expect(pg.query('select * from public.study_marks')).resolves.toMatchObject({ rows: [] });
    });
  });
});
