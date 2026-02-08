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

## 8) （MVP拡張）ユーザー招待（管理者機能）
ユーザー管理画面から「新規ユーザー作成（招待）」を使うには、Supabase Edge Function を1つデプロイします。

## 9) （Phase0）Provider設定/接続テスト（管理者機能）
Provider追加・シークレット保存・接続テストを使う場合、以下のEdge Functionをデプロイします。

- `supabase/functions/admin-provider-secret-upsert/index.ts`
- `supabase/functions/admin-provider-connection-test/index.ts`

### 必須シークレット
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROVIDER_CONFIG_ENCRYPTION_KEY`

※ `PROVIDER_CONFIG_ENCRYPTION_KEY` は32文字以上の十分にランダムな文字列を推奨します。
※ 既存の `admin-create-user` と同様に、Functions画面から登録します。

## （自動化）GitHub ActionsでDB反映（任意）
GitHubにSecretsを登録している場合、Actionsの `Supabase Apply SQL` を手動実行することで、DBへSQLを反映できます。

- `all`: `supabase/schema.sql` → `supabase/storage.sql` → `supabase/rls.sql` → `supabase/migrations/*.sql`
- `schema` / `storage` / `rls` / `migrations`: 個別適用

※Secretsの登録方法は `docs/08_GITHUB_SETUP_KNOMURA.md`、秘密情報の扱いは `docs/04_ENV_AND_SECRETS.md` を参照してください。

### 8-1) Edge Function をデプロイ
1. Supabaseダッシュボードで対象プロジェクトを開く
2. 左メニューの「Functions」を開く
3. 「New function」を押す
4. 名前を `admin-create-user` にする
5. `supabase/functions/admin-create-user/index.ts` の内容を貼り付けて保存

### 8-2) 環境変数（シークレット）を設定
Functions 画面の「Secrets」または「Settings」で以下を追加します。
- `SUPABASE_SERVICE_ROLE_KEY`（Supabase Project Settings → API → service_role）

※ `SUPABASE_URL` はSupabase側で自動注入されるため通常不要ですが、もし必要なら追加してください。

### 8-3) 動作確認
管理画面「ユーザー・契約管理」→「新規ユーザー作成」で招待メールが届けばOK。

## 注意
- `service_role key` はシークレットです。フロントに入れない/共有しないでください。
