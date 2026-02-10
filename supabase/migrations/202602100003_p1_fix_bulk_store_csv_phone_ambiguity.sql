-- Phase1: Fix ambiguous column reference in bulk_create_stores_for_user()
-- 背景:
--  - CSV一括作成時に `column reference "phone" is ambiguous (42702)` が発生
--  - PL/pgSQLローカル変数名と stores.phone の競合を解消する

create or replace function public.bulk_create_stores_for_user(
  target_org_id uuid,
  target_user_id uuid,
  rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  line_no integer;
  row_item record;
  row_count integer := 0;
  current_count integer := 0;
  limit_value integer := 1;
  allow_bulk boolean := false;
  errors jsonb := '[]'::jsonb;
  seen_keys text[] := array[]::text[];
  duplicate_key text;
  store_name text;
  row_address text;
  row_phone text;
  row_category text;
  row_business_hours text;
  row_website text;
  created_store_id uuid;
begin
  if actor_id is null then
    raise exception 'unauthenticated';
  end if;

  if target_org_id is null or target_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('line', 1, 'column', 'target_user_id', 'code', 'REQUIRED', 'message', '対象組織または対象ユーザーが未指定です。')
      )
    );
  end if;

  if not public.actor_can_manage_user_store_control(target_org_id, target_user_id) then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('line', 1, 'column', 'target_user_id', 'code', 'FORBIDDEN', 'message', '対象ユーザーの店舗設定を管理する権限がありません。')
      )
    );
  end if;

  select coalesce(usc.allow_csv_store_bulk_create, false)
  into allow_bulk
  from public.user_store_controls usc
  where usc.org_id = target_org_id
    and usc.user_id = target_user_id;

  if not coalesce(allow_bulk, false) then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('line', 1, 'column', 'allow_csv_store_bulk_create', 'code', 'CSV_DISABLED', 'message', 'CSV一括店舗作成がOFFです。')
      )
    );
  end if;

  if rows is null or jsonb_typeof(rows) <> 'array' then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('line', 1, 'column', 'csv', 'code', 'INVALID_PAYLOAD', 'message', 'CSVデータ形式が不正です。')
      )
    );
  end if;

  row_count := jsonb_array_length(rows);
  if row_count = 0 then
    errors := errors || jsonb_build_array(
      jsonb_build_object('line', 1, 'column', 'csv', 'code', 'EMPTY', 'message', 'CSVに有効な行がありません。')
    );
  end if;
  if row_count > 500 then
    errors := errors || jsonb_build_array(
      jsonb_build_object('line', 1, 'column', 'csv', 'code', 'ROW_LIMIT', 'message', 'CSVの行数上限は500件です。')
    );
  end if;

  for row_item in
    select value, ordinality
    from jsonb_array_elements(rows) with ordinality
  loop
    line_no := row_item.ordinality + 1;

    if jsonb_typeof(row_item.value) <> 'object' then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'row', 'code', 'INVALID_ROW', 'message', '行データ形式が不正です。')
      );
      continue;
    end if;

    store_name := nullif(trim(coalesce(row_item.value->>'store_name', '')), '');
    row_address := nullif(trim(coalesce(row_item.value->>'address', '')), '');
    row_phone := nullif(trim(coalesce(row_item.value->>'phone', '')), '');
    row_category := nullif(trim(coalesce(row_item.value->>'category', '')), '');
    row_business_hours := nullif(trim(coalesce(row_item.value->>'business_hours', '')), '');
    row_website := nullif(trim(coalesce(row_item.value->>'website', '')), '');

    if store_name is null then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'store_name', 'code', 'REQUIRED', 'message', 'store_name は必須です。')
      );
    end if;
    if row_address is null then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'address', 'code', 'REQUIRED', 'message', 'address は必須です。')
      );
    end if;
    if row_phone is null then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'phone', 'code', 'REQUIRED', 'message', 'phone は必須です。')
      );
    end if;
    if row_category is null then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'category', 'code', 'REQUIRED', 'message', 'category は必須です。')
      );
    end if;

    if row_website is not null and row_website !~* '^https?://[^[:space:]]+$' then
      errors := errors || jsonb_build_array(
        jsonb_build_object('line', line_no, 'column', 'website', 'code', 'INVALID_URL', 'message', 'website は http:// または https:// で始まるURL形式で入力してください。')
      );
    end if;

    if store_name is not null and row_phone is not null then
      duplicate_key := lower(store_name) || '||' || row_phone;
      if duplicate_key = any(seen_keys) then
        errors := errors || jsonb_build_array(
          jsonb_build_object('line', line_no, 'column', 'store_name', 'code', 'DUPLICATE_IN_CSV', 'message', '同一CSV内で store_name + phone が重複しています。')
        );
      else
        seen_keys := array_append(seen_keys, duplicate_key);
      end if;

      if exists (
        select 1
        from public.stores s
        where s.org_id = target_org_id
          and lower(s.name) = lower(store_name)
          and coalesce(s.phone, '') = row_phone
      ) then
        errors := errors || jsonb_build_array(
          jsonb_build_object('line', line_no, 'column', 'store_name', 'code', 'DUPLICATE_EXISTING', 'message', '既存店舗と store_name + phone が重複しています。')
        );
      end if;
    end if;
  end loop;

  if jsonb_array_length(errors) = 0 then
    current_count := public.user_store_count(target_org_id, target_user_id);
    limit_value := public.effective_user_store_limit(target_org_id, target_user_id);
    if current_count + row_count > limit_value then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'line', 1,
          'column', 'max_stores',
          'code', 'STORE_LIMIT_EXCEEDED',
          'message', format('上限を超えています。現在 %s / 上限 %s / 追加要求 %s', current_count, limit_value, row_count)
        )
      );
    end if;
  end if;

  if jsonb_array_length(errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'created_count', 0,
      'errors', errors
    );
  end if;

  for row_item in
    select value, ordinality
    from jsonb_array_elements(rows) with ordinality
  loop
    store_name := nullif(trim(coalesce(row_item.value->>'store_name', '')), '');
    row_address := nullif(trim(coalesce(row_item.value->>'address', '')), '');
    row_phone := nullif(trim(coalesce(row_item.value->>'phone', '')), '');
    row_category := nullif(trim(coalesce(row_item.value->>'category', '')), '');
    row_business_hours := nullif(trim(coalesce(row_item.value->>'business_hours', '')), '');
    row_website := nullif(trim(coalesce(row_item.value->>'website', '')), '');

    insert into public.stores (
      org_id,
      name,
      address,
      phone,
      website,
      category,
      business_hours
    )
    values (
      target_org_id,
      store_name,
      row_address,
      row_phone,
      row_website,
      row_category,
      row_business_hours
    )
    returning id into created_store_id;

    insert into public.memberships (
      user_id,
      org_id,
      store_id,
      role
    )
    values (
      target_user_id,
      target_org_id,
      created_store_id,
      'USER'
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created_count', row_count,
    'errors', '[]'::jsonb
  );
end;
$$;
