-- CitizensWatch update 2: old-photo checks, phone fingerprints for confirmations,
-- and updates that people add to an existing report.
-- Paste into Supabase > SQL Editor > New query, then press Run. Safe to run more than once.

-- Reports: flag for photos that look older than the event, the poster's
-- fingerprint code (so they cannot confirm their own report), and an update count.
alter table public.reports add column if not exists old_media boolean not null default false;
alter table public.reports add column if not exists net_fp text;
alter table public.reports add column if not exists updates integer not null default 0;

-- Votes: the voter's fingerprint code, so one phone counts once even after clearing its browser.
alter table public.votes add column if not exists net_fp text;
create index if not exists votes_netfp_idx on public.votes (report_id, kind, net_fp);

-- Updates people add to someone else's report: more photos, another angle, what happened next.
create table if not exists public.report_updates (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.reports(id) on delete cascade,
  created_at     timestamptz not null default now(),
  caption        text check (caption is null or char_length(caption) between 3 and 280),
  media          jsonb not null default '[]'::jsonb,
  sensitive      boolean not null default false,
  old_media      boolean not null default false,
  device_hash    text not null,
  net_fp         text,
  finalize_token text,
  status         text not null default 'pending' check (status in ('pending','visible','hidden')),
  hidden_reason  text,
  reviewed       boolean not null default false,
  flags          integer not null default 0,
  check (caption is not null or media <> '[]'::jsonb)
);
create index if not exists report_updates_report_idx on public.report_updates (report_id, status, created_at);
create index if not exists report_updates_status_idx on public.report_updates (status, created_at desc);

create table if not exists public.update_flags (
  update_id   uuid not null references public.report_updates(id) on delete cascade,
  device_hash text not null,
  reason      text check (reason in ('face','graphic','hate','old','spam','other')),
  created_at  timestamptz not null default now(),
  primary key (update_id, device_hash)
);

alter table public.report_updates enable row level security;
alter table public.update_flags   enable row level security;

-- Housekeeping now also clears updates whose uploads never finished.
create or replace function public.cleanup_old_rows() returns void
language sql security definer set search_path = public as $$
  delete from public.rate_events where created_at < now() - interval '2 days';
  delete from public.reports where status = 'pending' and created_at < now() - interval '1 day';
  delete from public.report_updates where status = 'pending' and created_at < now() - interval '1 day';
$$;
revoke all on function public.cleanup_old_rows() from public, anon, authenticated;
grant execute on function public.cleanup_old_rows() to service_role;
