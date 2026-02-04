-- TEPPEN MEO MVP storage setup
-- 最終更新: 2026-02-04
--
-- 目的:
-- - 投稿メディア用のStorageバケットを作成する
-- - すでに存在する場合は何もしない

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'post-media') then
    insert into storage.buckets (id, name, public)
    values ('post-media', 'post-media', false);
  end if;
end $$;

