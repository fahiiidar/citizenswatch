-- CitizensWatch database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- It is safe to run more than once.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Reports
-- Exact locations are never stored. The app rounds every point to the centre
-- of a ~1 km grid cell on the phone, and the server rounds it again.
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  category       text not null check (category in
                   ('gunmen','kidnapping','attack','road','robbery','avoid','clear','other')),
  is_now         boolean not null default false,
  occurred_on    date not null,
  time_of_day    text check (time_of_day in ('morning','afternoon','evening','night')),
  occurred_at    timestamptz not null,            -- best estimate, used for time filters
  caption        text not null check (char_length(caption) between 3 and 280),
  place_label    text not null check (char_length(place_label) between 2 and 140),
  area_label     text check (char_length(area_label) <= 140),
  lat            double precision not null check (lat between 3.5 and 14.5),
  lng            double precision not null check (lng between 2.0 and 15.5),
  media          jsonb not null default '[]'::jsonb,   -- [{ "path": "...", "type": "image/jpeg" }]
  sensitive      boolean not null default false,
  device_hash    text not null,
  finalize_token text,
  status         text not null default 'pending' check (status in ('pending','visible','hidden')),
  hidden_reason  text,
  reviewed       boolean not null default false,
  mod_override   text check (mod_override in ('corroborated','disputed')),
  confirms       integer not null default 0,
  falses         integer not null default 0,
  flags          integer not null default 0
);

create index if not exists reports_status_occurred_idx on public.reports (status, occurred_at desc);
create index if not exists reports_device_idx on public.reports (device_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- Confirmations, "false or old" votes and flags. One of each per phone per report.
-- ---------------------------------------------------------------------------
create table if not exists public.votes (
  report_id   uuid not null references public.reports(id) on delete cascade,
  device_hash text not null,
  kind        text not null check (kind in ('confirm','false','flag')),
  reason      text check (reason in ('face','graphic','hate','old','spam','other')),
  created_at  timestamptz not null default now(),
  primary key (report_id, device_hash, kind)
);

-- Keeps the counters on each report in step with the votes table,
-- and hides a report automatically once 5 different phones flag it.
create or replace function public.apply_vote_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid uuid := coalesce(new.report_id, old.report_id);
begin
  update public.reports r set
    confirms = (select count(*) from public.votes v where v.report_id = rid and v.kind = 'confirm'),
    falses   = (select count(*) from public.votes v where v.report_id = rid and v.kind = 'false'),
    flags    = (select count(*) from public.votes v where v.report_id = rid and v.kind = 'flag')
  where r.id = rid;

  update public.reports r set status = 'hidden', hidden_reason = 'auto: 5 flags'
  where r.id = rid and r.status = 'visible' and r.reviewed = false and r.flags >= 5;

  return null;
end $$;

drop trigger if exists votes_counts on public.votes;
create trigger votes_counts after insert or delete on public.votes
for each row execute function public.apply_vote_counts();

-- ---------------------------------------------------------------------------
-- Rate limiting, blocked phones and a moderation log
-- IP addresses are never stored, only a salted one-way hash.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_events (
  id         bigserial primary key,
  key        text not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_lookup_idx on public.rate_events (key, kind, created_at desc);

create table if not exists public.blocked_devices (
  device_hash text primary key,
  created_at  timestamptz not null default now(),
  note        text
);

create table if not exists public.mod_log (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  moderator  text not null,
  report_id  uuid,
  action     text not null,
  detail     text
);

-- Counts recent events for a key and records a new one in a single call.
create or replace function public.hit_rate(p_key text, p_kind text, p_window_seconds integer)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.rate_events
   where key = p_key and kind = p_kind
     and created_at > now() - make_interval(secs => p_window_seconds);
  insert into public.rate_events (key, kind) values (p_key, p_kind);
  return n;
end $$;

-- Housekeeping: forget rate events after two days and unfinished uploads after a day.
create or replace function public.cleanup_old_rows() returns void
language sql security definer set search_path = public as $$
  delete from public.rate_events where created_at < now() - interval '2 days';
  delete from public.reports where status = 'pending' and created_at < now() - interval '1 day';
$$;

-- ---------------------------------------------------------------------------
-- Lock everything down. The website never talks to these tables directly;
-- only the app's server (using the secret service key) can read or write.
-- ---------------------------------------------------------------------------
alter table public.reports         enable row level security;
alter table public.votes           enable row level security;
alter table public.rate_events     enable row level security;
alter table public.blocked_devices enable row level security;
alter table public.mod_log         enable row level security;

revoke all on function public.hit_rate(text, text, integer) from public, anon, authenticated;
revoke all on function public.cleanup_old_rows() from public, anon, authenticated;
revoke all on function public.apply_vote_counts() from public, anon, authenticated;
grant execute on function public.hit_rate(text, text, integer) to service_role;
grant execute on function public.cleanup_old_rows() to service_role;

-- ---------------------------------------------------------------------------
-- Private storage for photos and clips. Files are shown through short-lived
-- signed links, so a hidden report's media stops loading.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 15728640,
        array['image/jpeg','video/webm','video/mp4'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
