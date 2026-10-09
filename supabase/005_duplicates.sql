-- CitizensWatch: guards against duplicate posts and reused photos.
-- Run once in Supabase > SQL Editor. Safe to run again.

-- "Photo seen before": set when a photo matches one already posted on another report.
alter table public.reports add column if not exists seen_media boolean not null default false;
alter table public.reports add column if not exists seen_of uuid;
alter table public.report_updates add column if not exists seen_media boolean not null default false;
alter table public.report_updates add column if not exists seen_of uuid;

-- A small visual fingerprint of every posted photo or clip (64 bits as 16 hex
-- characters). It cannot be turned back into the picture.
create table if not exists public.media_prints (
  id bigint generated always as identity primary key,
  print text not null check (print ~ '^[0-9a-f]{16}$'),
  report_id uuid not null references public.reports(id) on delete cascade,
  update_id uuid references public.report_updates(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists media_prints_created_idx on public.media_prints (created_at);
create index if not exists media_prints_report_idx on public.media_prints (report_id);
alter table public.media_prints enable row level security;

-- Finds earlier photos that look the same (at most p_max of 64 bits differ),
-- ignoring the report the new photo belongs to.
create or replace function public.find_similar_prints(p_prints text[], p_exclude uuid default null, p_max int default 6)
returns table (print text, report_id uuid)
language sql
stable
set search_path = public
as $$
  select distinct on (q.p) q.p, mp.report_id
  from unnest(p_prints) as q(p)
  join public.media_prints mp
    on bit_count((('x' || mp.print)::bit(64)) # (('x' || q.p)::bit(64))) <= p_max
  where q.p ~ '^[0-9a-f]{16}$'
    and (p_exclude is null or mp.report_id <> p_exclude)
    and mp.created_at > now() - interval '365 days'
  order by q.p, mp.created_at asc;
$$;
revoke execute on function public.find_similar_prints(text[], uuid, int) from public, anon, authenticated;

-- Speeds up the "same phone, same place, same kind" check.
create index if not exists reports_device_recent_idx on public.reports (device_hash, category, created_at desc);
create index if not exists reports_area_recent_idx on public.reports (category, created_at desc, lat, lng);
