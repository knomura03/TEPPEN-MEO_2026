-- Phase1: Fix public survey response/event insert RLS for anonymous respondents
-- 背景:
--  - 公開アンケートの回答送信で 42501 (RLS) が発生するケースを解消する
--  - 公開URL経由の read-only / write-only 導線を明示的に anon, authenticated に許可する

alter table public.survey_responses enable row level security;
alter table public.survey_events enable row level security;

drop policy if exists survey_responses_insert_public on public.survey_responses;
create policy survey_responses_insert_public
on public.survey_responses
for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and s.status = 'PUBLISHED'
      and s.public_token is not null
  )
);

drop policy if exists survey_responses_insert_by_store_access on public.survey_responses;
create policy survey_responses_insert_by_store_access
on public.survey_responses
for insert
to authenticated
with check (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);

drop policy if exists survey_events_insert_public on public.survey_events;
create policy survey_events_insert_public
on public.survey_events
for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and s.status = 'PUBLISHED'
      and s.public_token is not null
  )
);

drop policy if exists survey_events_insert_by_store_access on public.survey_events;
create policy survey_events_insert_by_store_access
on public.survey_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);
