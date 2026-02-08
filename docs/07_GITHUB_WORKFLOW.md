# GitHub運用ルール（TEPPEN MEO）

最終更新: 2026-02-03

## 目的
GitHubを「コードの変更・レビュー・履歴」の中心として使い、作業の見える化と品質担保を行います。

## 初期セットアップ（knomura作業）
- 最初の1回だけ、GitHub上にリポジトリを作る必要があります
- 手順は `docs/08_GITHUB_SETUP_KNOMURA.md` にまとめています

## チケット管理（Linearとの関係）
- 原則: **仕様/優先度/進捗はLinearが一次情報**
- GitHubは: **PR（コード変更）** を必ず残す
- PRには必ずLinearのIDを紐づける（例: `CYD-10`）

## ブランチ運用
- 直接 `main`（またはデフォルトブランチ）にpushしない
- ブランチ名は `codex/` プレフィックス（例: `codex/cyd-10-post-crud`）

## PR運用
- PRテンプレート（`.github/pull_request_template.md`）に沿って記入
- レビュー観点（最低限）
  - 影響範囲（どの画面/機能が変わるか）
  - セキュリティ（秘密情報が漏れていないか）
  - `npm run build` が通るか

## CI（GitHub Actions）
- `.github/workflows/ci.yml` で `npm run typecheck` / `npm run build` を実行します
- E2Eなどは段階的に追加します

## Supabase（DB反映の自動化）
- `.github/workflows/supabase_apply_sql.yml` を手動実行（workflow_dispatch）することで、以下を順に適用できます
  - `supabase/schema.sql`
  - `supabase/storage.sql`
  - `supabase/rls.sql`
  - `supabase/migrations/*.sql`（versioned, forward-only）

## 秘密情報（重要）
- `.env*` やOAuthシークレット等は **絶対にコミットしない**
- 詳細は `docs/04_ENV_AND_SECRETS.md` を参照
