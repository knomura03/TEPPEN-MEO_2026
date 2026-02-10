-- TEPPEN MEO Phase1 ticket P1-10 (survey customization + header media)
-- 最終更新: 2026-02-10
--
-- 目的:
-- - アンケート設問文言 / サンクス文言を編集可能にする
-- - 公開アンケートのヘッダー画像(1枚)設定を保存する
-- - ヘッダー画像アップロード用 Storage バケットとポリシーを追加する

alter table public.surveys
  add column if not exists header_image_url text,
  add column if not exists header_image_storage_path text,
  add column if not exists question_text text,
  add column if not exists thanks_title text,
  add column if not exists thanks_body text,
  add column if not exists thanks_positive_message text,
  add column if not exists thanks_negative_message text,
  add column if not exists thanks_button_text text;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'survey-media') then
    insert into storage.buckets (id, name, public)
    values ('survey-media', 'survey-media', true);
  end if;
end $$;

do $$
begin
  begin
    drop policy if exists survey_media_insert_authenticated on storage.objects;
    create policy survey_media_insert_authenticated
    on storage.objects
    for insert
    with check (
      bucket_id = 'survey-media'
      and auth.role() = 'authenticated'
      and public.user_has_store_access((split_part(name, '/', 1))::uuid)
    );
  exception
    when insufficient_privilege then
      raise notice 'storage.objects insert policy skipped: insufficient_privilege';
  end;

  begin
    drop policy if exists survey_media_delete_authenticated on storage.objects;
    create policy survey_media_delete_authenticated
    on storage.objects
    for delete
    using (
      bucket_id = 'survey-media'
      and auth.role() = 'authenticated'
      and public.user_has_store_access((split_part(name, '/', 1))::uuid)
    );
  exception
    when insufficient_privilege then
      raise notice 'storage.objects delete policy skipped: insufficient_privilege';
  end;
end $$;
