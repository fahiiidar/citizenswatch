-- CitizensWatch update 3: "Harassment by officials" category, with the agency involved.
-- Run AFTER 002_updates_and_checks.sql. Safe to run more than once.

alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check check (category in
  ('gunmen','kidnapping','attack','road','robbery','avoid','officials','clear','other'));

alter table public.reports add column if not exists agency text;
alter table public.reports drop constraint if exists reports_agency_check;
alter table public.reports add constraint reports_agency_check check (agency is null or agency in
  ('police','army','lastma','ndlea','frsc','vio','customs','immigration','nscdc','hisbah','vigilante','taskforce','other'));
