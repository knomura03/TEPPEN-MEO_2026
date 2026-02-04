# Supabase セットアップ（MVP）

最終更新: 2026-02-03

## 目的
ローカルのUIモックを、Supabase（Auth/DB/Storage）に接続して「実データ」で動かすための土台です。

## 使い方（最小）
### 1) Supabaseプロジェクトを作成
`docs/05_RUNBOOK_KNOMURA.md` の手順どおりに作成してください。

### 2) DBスキーマを反映
1. Supabaseの管理画面 → **SQL Editor** を開く
2. `supabase/schema.sql` の中身を貼り付けて実行
3. エラーが出なければOK

※RLS（行レベルセキュリティ）は `supabase/rls.sql` を別で適用します。

### 3) 初期データ（最初の店舗/所属）を作成
RLSを有効にすると「所属がないユーザー」は店舗データが見えません。最初の1回だけ、`supabase/bootstrap.sql` を使って初期データを作成します。

### 4) フロントの環境変数を設定
`.env.example` を参考に `.env.local` を作成し、以下を埋めてください。
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 注意
- `service_role key` はシークレットです。フロントに入れない/共有しないでください。
