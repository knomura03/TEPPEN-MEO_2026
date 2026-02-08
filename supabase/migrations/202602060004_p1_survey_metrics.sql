-- TEPPEN MEO Phase1 ticket P1-03 (survey metrics / CSV)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - アンケート閲覧数/遷移クリック数を計測する
-- - 回答率/分岐率算出の元データを保存する

create table if not exists public.survey_events (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  event_type text not null check (event_type in ('VIEW', 'REDIRECT_CLICK')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists survey_events_survey_id_idx on public.survey_events(survey_id);
create index if not exists survey_events_event_type_idx on public.survey_events(event_type);
create index if not exists survey_events_created_at_idx on public.survey_events(created_at);

alter table public.survey_events enable row level security;

drop policy if exists survey_events_select_by_store_access on public.survey_events;
create policy survey_events_select_by_store_access
on public.survey_events
for select
using (
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
with check (
  public.is_published_survey(survey_id)
  and event_type in ('VIEW', 'REDIRECT_CLICK')
);

drop policy if exists survey_events_insert_by_store_access on public.survey_events;
create policy survey_events_insert_by_store_access
on public.survey_events
for insert
with check (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);
