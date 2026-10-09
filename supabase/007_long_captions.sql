-- CitizensWatch: imported social media posts keep their full original wording,
-- which can be longer than 280 characters. Reports posted on the site itself
-- are still limited to 280 by the app.
-- Run once in Supabase > SQL Editor. Safe to run again.
alter table public.reports drop constraint if exists reports_caption_check;
alter table public.reports add constraint reports_caption_check
  check (char_length(caption) between 3 and 4000);
