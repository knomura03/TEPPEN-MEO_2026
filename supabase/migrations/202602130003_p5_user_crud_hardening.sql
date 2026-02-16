-- Phase5: User CRUD hardening
-- 目的:
-- - 招待運用の可視化（invited_at）
-- - 初回パスワード設定完了の可視化（password_set_at）

alter table public.profiles
  add column if not exists invited_at timestamptz;

alter table public.profiles
  add column if not exists password_set_at timestamptz;

create index if not exists profiles_invited_at_idx
  on public.profiles(invited_at);

create index if not exists profiles_password_set_at_idx
  on public.profiles(password_set_at);
