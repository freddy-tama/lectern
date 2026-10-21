-- Lectern accounts: AI credits and study progress.
-- Run once in the Supabase SQL editor (Database → SQL editor → New query). Running it again is safe.
--
-- Credits: every account starts with 4000 credits ($20 of AI use; 1 credit = $0.005). Only the
-- server, with the project's secret key, can open accounts or spend credits. People can read
-- their own balance and spending.
-- Study progress: which slides of a deck someone has marked as learning or known. People read
-- and write only their own.

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  credits numeric(12, 3) not null,
  granted numeric(12, 3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  credits numeric(12, 3) not null,
  detail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists credit_events_by_user on public.credit_events (user_id, created_at desc);

-- What everyone spent each day (UTC), for the site-wide daily cap.
create table if not exists public.credit_days (
  day date primary key,
  credits numeric(14, 3) not null default 0
);

alter table public.credit_accounts enable row level security;
alter table public.credit_events enable row level security;
alter table public.credit_days enable row level security;

drop policy if exists "read own credits" on public.credit_accounts;
create policy "read own credits" on public.credit_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists "read own spending" on public.credit_events;
create policy "read own spending" on public.credit_events for select to authenticated using (user_id = auth.uid());

-- The balance, opening the account with the starting grant on first use, and today's spending across the site.
create or replace function public.lectern_credit_status(p_user uuid, p_start numeric)
returns table (balance numeric, spent_today numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into credit_accounts (user_id, credits, granted) values (p_user, p_start, p_start)
  on conflict (user_id) do nothing;
  return query
    select a.credits,
           coalesce((select d.credits from credit_days d where d.day = (now() at time zone 'utc')::date), 0::numeric)
    from credit_accounts a
    where a.user_id = p_user;
end;
$$;

-- Takes what one AI request cost from the balance in a single statement, so two requests at
-- once can't both spend the same credits. Returns the new balance, which can dip below zero
-- by the last request's cost; the next request is then refused.
create or replace function public.lectern_spend(p_user uuid, p_credits numeric, p_endpoint text, p_detail jsonb, p_start numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  left_over numeric;
begin
  if p_credits is null or p_credits < 0 then
    raise exception 'The amount to spend must be zero or more.';
  end if;
  insert into credit_accounts (user_id, credits, granted) values (p_user, p_start, p_start)
  on conflict (user_id) do nothing;
  update credit_accounts
     set credits = credits - p_credits, updated_at = now()
   where user_id = p_user
  returning credits into left_over;
  insert into credit_events (user_id, endpoint, credits, detail)
  values (p_user, left(p_endpoint, 60), p_credits, coalesce(p_detail, '[]'::jsonb));
  insert into credit_days (day, credits) values ((now() at time zone 'utc')::date, p_credits)
  on conflict (day) do update set credits = credit_days.credits + excluded.credits;
  return left_over;
end;
$$;

-- Supabase lets anyone signed in call functions in the public schema unless told otherwise.
revoke all on function public.lectern_credit_status(uuid, numeric) from public, anon, authenticated;
revoke all on function public.lectern_spend(uuid, numeric, text, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.lectern_credit_status(uuid, numeric) to service_role;
grant execute on function public.lectern_spend(uuid, numeric, text, jsonb, numeric) to service_role;

create table if not exists public.study_marks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id text not null check (length(deck_id) between 1 and 200),
  slide_id text not null check (length(slide_id) between 1 and 200),
  status text not null check (status in ('learning', 'known')),
  updated_at bigint not null,
  primary key (user_id, deck_id, slide_id)
);

alter table public.study_marks enable row level security;
drop policy if exists "own study marks" on public.study_marks;
create policy "own study marks" on public.study_marks for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Newer Supabase projects don't open new tables to signed-in people by default. The policies
-- above still decide which rows they see.
grant select on public.credit_accounts, public.credit_events to authenticated;
grant select, insert, update, delete on public.study_marks to authenticated;
