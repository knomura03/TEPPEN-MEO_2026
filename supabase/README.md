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

### 3) Authユーザーを作成（初回のみ）
TEPPEN MEO のログインに必要なので、Supabaseの **Authentication → Users** でユーザーを作成します。
詳細は `docs/05_RUNBOOK_KNOMURA.md` に沿って進めてください。

### 4) 初期データ（最初の店舗/所属）を作成
RLSを有効にすると「所属がないユーザー」は店舗データが見えません。最初の1回だけ、`supabase/bootstrap.sql` を使って初期データを作成します。

### 5) Storageバケットを作成（投稿画像用）
以下どちらかでOKです。

**A. SQLで作成（おすすめ）**
1. Supabaseの管理画面 → **SQL Editor** を開く
2. `supabase/storage.sql` の中身を貼り付けて実行

**B. 画面で作成**
1. 左メニューの「Storage」を開く
2. 「New bucket」を押す
3. Name を `post-media` にする
4. 「Public」は OFF（非公開）にする
5. 「Create bucket」を押す

### 6) Storageポリシーを設定（GUIでOK）
StorageのポリシーはSQLでエラーになることがあるため、**GUIで設定**します。
手順は `docs/05_RUNBOOK_KNOMURA.md` を参照してください。

### 7) フロントの環境変数を設定
`.env.example` を参考に `.env.local` を作成し、以下を埋めてください。
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 注意
- `service_role key` はシークレットです。フロントに入れない/共有しないでください。
