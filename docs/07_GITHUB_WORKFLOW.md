# GitHub運用ルール（TEPPEN MEO）

最終更新: 2026-02-03

## 目的
GitHubを「コードの変更・レビュー・履歴」の中心として使い、作業の見える化と品質担保を行います。

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
- `.github/workflows/ci.yml` で `npm run build` を実行します
- 将来、型チェックやE2Eなどは段階的に追加します

## 秘密情報（重要）
- `.env*` やOAuthシークレット等は **絶対にコミットしない**
- 詳細は `docs/04_ENV_AND_SECRETS.md` を参照

