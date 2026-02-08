-- TEPPEN MEO Phase1 ticket P1-01 (surveys)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - アンケート作成/公開の基盤テーブルを追加
-- - 公開URLから匿名回答を受け付ける
-- - 作成/管理は店舗アクセスユーザーに限定する

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  review_redirect_url text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  public_token text unique,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surveys_store_id_idx on public.surveys(store_id);
create index if not exists surveys_author_user_id_idx on public.surveys(author_user_id);
create index if not exists surveys_status_idx on public.surveys(status);
create index if not exists surveys_public_token_idx on public.surveys(public_token);
create unique index if not exists surveys_published_single_per_author_idx
  on public.surveys(author_user_id)
  where status = 'PUBLISHED';

drop trigger if exists surveys_set_updated_at on public.surveys;
create trigger surveys_set_updated_at
before update on public.surveys
for each row execute function public.set_updated_at();

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  source text not null default 'PUBLIC_URL',
  created_at timestamptz not null default now()
);

create index if not exists survey_responses_survey_id_idx on public.survey_responses(survey_id);
create index if not exists survey_responses_created_at_idx on public.survey_responses(created_at);

create or replace function public.is_published_survey(target_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.surveys s
    where s.id = target_survey_id
      and s.status = 'PUBLISHED'
      and s.public_token is not null
  );
$$;

alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;

drop policy if exists surveys_select_by_store_access on public.surveys;
create policy surveys_select_by_store_access
on public.surveys
for select
using (public.user_has_store_access(store_id));

drop policy if exists surveys_select_public_published on public.surveys;
create policy surveys_select_public_published
on public.surveys
for select
using (
  auth.uid() is null
  and status = 'PUBLISHED'
  and public_token is not null
);

drop policy if exists surveys_insert_by_store_access on public.surveys;
create policy surveys_insert_by_store_access
on public.surveys
for insert
with check (
  public.user_has_store_access(store_id)
  and author_user_id = auth.uid()
);

drop policy if exists surveys_update_by_store_access on public.surveys;
create policy surveys_update_by_store_access
on public.surveys
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

drop policy if exists surveys_delete_by_store_access on public.surveys;
create policy surveys_delete_by_store_access
on public.surveys
for delete
using (public.user_has_store_access(store_id));

drop policy if exists survey_responses_select_by_store_access on public.survey_responses;
create policy survey_responses_select_by_store_access
on public.survey_responses
for select
using (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);

drop policy if exists survey_responses_insert_public on public.survey_responses;
create policy survey_responses_insert_public
on public.survey_responses
for insert
with check (public.is_published_survey(survey_id));

drop policy if exists survey_responses_insert_by_store_access on public.survey_responses;
create policy survey_responses_insert_by_store_access
on public.survey_responses
for insert
with check (
  exists (
    select 1
    from public.surveys s
    where s.id = survey_id
      and public.user_has_store_access(s.store_id)
  )
);
