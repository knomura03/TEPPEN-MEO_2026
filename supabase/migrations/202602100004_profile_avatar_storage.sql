-- Profile avatar storage bucket and policies
-- 最終更新: 2026-02-10

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'avatars') then
    insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true);
  end if;
end $$;

do $$
begin
  begin
    drop policy if exists avatars_insert_own on storage.objects;
    create policy avatars_insert_own
    on storage.objects
    for insert
    with check (
      bucket_id = 'avatars'
      and auth.role() = 'authenticated'
      and split_part(name, '/', 1) = auth.uid()::text
    );
  exception
    when insufficient_privilege then
      raise notice 'storage.objects avatars insert policy skipped: insufficient_privilege';
  end;

  begin
    drop policy if exists avatars_update_own on storage.objects;
    create policy avatars_update_own
    on storage.objects
    for update
    using (
      bucket_id = 'avatars'
      and auth.role() = 'authenticated'
      and split_part(name, '/', 1) = auth.uid()::text
    )
    with check (
      bucket_id = 'avatars'
      and auth.role() = 'authenticated'
      and split_part(name, '/', 1) = auth.uid()::text
    );
  exception
    when insufficient_privilege then
      raise notice 'storage.objects avatars update policy skipped: insufficient_privilege';
  end;

  begin
    drop policy if exists avatars_delete_own on storage.objects;
    create policy avatars_delete_own
    on storage.objects
    for delete
    using (
      bucket_id = 'avatars'
      and auth.role() = 'authenticated'
      and split_part(name, '/', 1) = auth.uid()::text
    );
  exception
    when insufficient_privilege then
      raise notice 'storage.objects avatars delete policy skipped: insufficient_privilege';
  end;
end $$;

