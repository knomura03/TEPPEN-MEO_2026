-- TEPPEN MEO Phase3 ticket P3-01 (rank keyword management)
-- 最終更新: 2026-02-08
--
-- 目的:
-- - 店舗ごとの順位計測用キーワードを管理（CRUD）できるようにする
-- - P3-02（順位収集ジョブ）の入力データとして利用する

create table if not exists public.rank_keywords (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  keyword text not null,
  note text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rank_keywords_keyword_len_check check (char_length(keyword) between 1 and 80)
);

create index if not exists rank_keywords_store_id_idx on public.rank_keywords(store_id);
create index if not exists rank_keywords_active_idx on public.rank_keywords(is_active);
create unique index if not exists rank_keywords_store_keyword_unique_idx
  on public.rank_keywords(store_id, lower(keyword));

drop trigger if exists rank_keywords_set_updated_at on public.rank_keywords;
create trigger rank_keywords_set_updated_at
before update on public.rank_keywords
for each row execute function public.set_updated_at();

alter table public.rank_keywords enable row level security;

drop policy if exists rank_keywords_select_by_store_scope on public.rank_keywords;
create policy rank_keywords_select_by_store_scope
on public.rank_keywords
for select
using (public.user_has_store_access(store_id));

drop policy if exists rank_keywords_insert_by_store_scope on public.rank_keywords;
create policy rank_keywords_insert_by_store_scope
on public.rank_keywords
for insert
with check (public.user_has_store_access(store_id));

drop policy if exists rank_keywords_update_by_store_scope on public.rank_keywords;
create policy rank_keywords_update_by_store_scope
on public.rank_keywords
for update
using (public.user_has_store_access(store_id))
with check (public.user_has_store_access(store_id));

drop policy if exists rank_keywords_delete_by_store_scope on public.rank_keywords;
create policy rank_keywords_delete_by_store_scope
on public.rank_keywords
for delete
using (public.user_has_store_access(store_id));

grant select, insert, update, delete on public.rank_keywords to authenticated;
