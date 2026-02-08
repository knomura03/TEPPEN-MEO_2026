-- TEPPEN MEO Phase1 ticket P1-02 (survey branching)
-- 最終更新: 2026-02-06
--
-- 目的:
-- - 高評価/低評価の分岐導線を永続化する
-- - 高評価しきい値をアンケートごとに設定可能にする
-- - 回答ごとに分岐結果を保持する

alter table public.surveys
  add column if not exists positive_threshold integer not null default 4;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'surveys_positive_threshold_check'
      and conrelid = 'public.surveys'::regclass
  ) then
    alter table public.surveys
      add constraint surveys_positive_threshold_check
      check (positive_threshold between 2 and 5);
  end if;
end $$;

alter table public.survey_responses
  add column if not exists branch_type text;

update public.survey_responses
set branch_type = case
  when rating >= 4 then 'POSITIVE'
  else 'NEGATIVE'
end
where branch_type is null;

alter table public.survey_responses
  alter column branch_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'survey_responses_branch_type_check'
      and conrelid = 'public.survey_responses'::regclass
  ) then
    alter table public.survey_responses
      add constraint survey_responses_branch_type_check
      check (branch_type in ('POSITIVE', 'NEGATIVE'));
  end if;
end $$;
