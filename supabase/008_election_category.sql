-- CitizensWatch update 8: "Election" category, with what kind of election problem it was.
-- Run once in Supabase > SQL Editor. Safe to run again.

alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check check (category in
  ('gunmen','kidnapping','attack','road','robbery','avoid','officials','election','clear','other'));

alter table public.reports add column if not exists election_kind text;
alter table public.reports drop constraint if exists reports_election_kind_check;
alter table public.reports add constraint reports_election_kind_check check (election_kind is null or election_kind in
  ('intimidation','violence','vote_buying','rigging','suppression','arrest','other'));
