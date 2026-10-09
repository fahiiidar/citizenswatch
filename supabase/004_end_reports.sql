-- CitizensWatch update 4: mark a report as over when the incident has ended.
-- Ended reports leave the map by default but stay in the record. Safe to run more than once.

alter table public.reports add column if not exists ended_at timestamptz;
alter table public.reports add column if not exists ended_by text;
create index if not exists reports_ended_idx on public.reports (status, ended_at);
