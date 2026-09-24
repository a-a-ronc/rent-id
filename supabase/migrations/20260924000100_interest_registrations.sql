-- Prospective-user registrations ("Join RentID" / letter of intent).
--
-- This table was created by drizzle-kit against the Lovable-managed database
-- (drizzle/migrations/0000 and 0001), outside supabase/migrations. A fresh
-- Supabase project built with `supabase db push` therefore never got it, and
-- /join failed on every submission. Folding it in here makes the migration set
-- self-sufficient.
--
-- Written to be idempotent so it is also safe against a database that already
-- has the table from the drizzle path.

create table if not exists public.interest_registrations (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  email_normalized text not null,
  phone text not null,
  roles text[] not null default '{}',
  would_use boolean not null,
  acknowledged boolean not null default false,
  submitted_at timestamptz not null default now(),
  submission_count integer not null default 1,
  user_agent text,
  ip_address text,
  referer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.interest_registrations
  add column if not exists current_units integer,
  add column if not exists intended_units integer;

create unique index if not exists interest_registrations_email_key
  on public.interest_registrations (email_normalized);
create index if not exists interest_registrations_submitted_at_idx
  on public.interest_registrations (submitted_at desc);
create index if not exists interest_registrations_would_use_idx
  on public.interest_registrations (would_use);

-- Public submissions are written server-side with the service role; there is
-- deliberately no anon policy. Only admins can read.
revoke all on public.interest_registrations from anon;
grant select on public.interest_registrations to authenticated;
grant all on public.interest_registrations to service_role;

alter table public.interest_registrations enable row level security;

drop policy if exists "Admins can read registrations" on public.interest_registrations;
create policy "Admins can read registrations"
on public.interest_registrations
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

drop trigger if exists interest_registrations_touch on public.interest_registrations;
create trigger interest_registrations_touch
before update on public.interest_registrations
for each row execute function public.touch_updated_at();
