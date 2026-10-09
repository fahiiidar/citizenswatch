-- CitizensWatch: reports imported from social media.
-- Run once in Supabase > SQL Editor. Safe to run again.

-- 'public' = posted on CitizensWatch; 'imported' = brought in from social media.
alter table public.reports add column if not exists origin text not null default 'public';
alter table public.reports drop constraint if exists reports_origin_check;
alter table public.reports add constraint reports_origin_check check (origin in ('public', 'imported'));

-- Where an imported report came from. Only moderators ever see these,
-- so takedown requests can be matched to the original post.
alter table public.reports add column if not exists source_url text;
alter table public.reports add column if not exists source_kind text;

create unique index if not exists reports_source_url_idx on public.reports (source_url) where source_url is not null;
