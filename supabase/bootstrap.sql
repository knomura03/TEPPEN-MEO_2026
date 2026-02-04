-- TEPPEN MEO MVP bootstrap
-- 最終更新: 2026-02-03
--
-- 目的:
-- - 最初の Organization / Store / Membership（ADMIN）を作成する
-- - 「店舗が未設定」で詰まらないようにする
--
-- 使い方:
-- 1) Supabase → SQL Editor を開く
-- 2) `YOUR_EMAIL_HERE` を「最初にログインしたユーザーのメール」に置き換える
-- 3) 実行する

do $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_store_id uuid;
begin
  select id into v_user_id
  from auth.users
  where email = 'YOUR_EMAIL_HERE';

  if v_user_id is null then
    raise exception 'auth.users に該当ユーザーが見つかりません。先にログイン/ユーザー作成してください。';
  end if;

  insert into public.organizations (name)
  values ('TEPPEN')
  returning id into v_org_id;

  insert into public.stores (org_id, name)
  values (v_org_id, 'TEPPEN総本店')
  returning id into v_store_id;

  insert into public.memberships (user_id, org_id, store_id, role, permissions)
  values (v_user_id, v_org_id, v_store_id, 'ADMIN', '{}'::jsonb);
end $$;

