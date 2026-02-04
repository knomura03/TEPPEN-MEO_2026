# TEPPEN MEO：環境変数 & 秘密情報の取り扱い（MVP）

最終更新: 2026-02-03

## 目的
knomuraが混乱せずに進められるよう、**何をどこに設定するか**を固定します。

また、秘密情報（シークレット）を誤ってフロントやGitに出さないためのルールを明文化します。

## 原則（必ず守る）
- **秘密情報はクライアント（ブラウザ）に置かない**
- **秘密情報はGitにコミットしない**
- 迷ったら「共有しない」→こちらに確認

## 現状（このリポジトリの状態）
- `.env.local` が存在します（プレースホルダー）。
- `*.local` は `.gitignore` 対象ですが、実際の運用でキーを入れた場合、**誤コミットに注意**してください（`git status` で変更が出ます）。

## フロント用 env（MVP）
フロントは公開されても良いキー（anon key等）だけを持ちます。

例:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

※`VITE_` から始まる環境変数はビルド時にフロントへ埋め込まれるため、**シークレットは禁止**です。

## サーバー用 env（MVP）
Edge Functions等の“サーバー側”だけが持つべきものです。フロントに入れてはいけません。

例:
- `SUPABASE_SERVICE_ROLE_KEY`（サーバー側のみ）
- `GOOGLE_OAUTH_CLIENT_ID`（公開して良いが、管理はサーバー側でOK）
- `GOOGLE_OAUTH_CLIENT_SECRET`（シークレット：サーバー側のみ）

## “GUIで設定できる”理想と、MVPの現実解
### 理想（最終）
- ADMINページでAPIキー等をGUI登録
- 保存は暗号化し、実行はEdge Functions経由
- 変更は監査ログに残る

### MVP（現実解）
- まずは **環境変数で安全に運用**
- “鍵をGUIで入れる”は後続フェーズで実装（セキュリティ要件が高い）

## ローカル/本番の切替ルール
- ローカル: `.env.local` を使用（値は共有しない）
- 本番: デプロイ先の管理画面で環境変数を設定
- 変数名はローカルと本番で統一（同名）

## knomuraに共有してほしい情報（最小）
Supabaseの以下2つ（フロント接続に必要）:
- `Project URL`
- `anon public key`

※`service_role key` の共有は原則不要（こちらで運用する）。

## GitHub Actions（自動化）で使うSecrets（MVP）
DB反映やFunctionsデプロイ等を自動化するため、GitHubリポジトリの `Settings → Secrets and variables → Actions` に登録します。

- `PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_SERVICE_ROLE_KEY`

※これらは **絶対にコードや `.env.local` に入れない** でください。
