# 自動で「実装→検証→修正」を回すために必要なもの（TEPPEN MEO）

最終更新: 2026-02-04

## 目的
私（Codex）が **実装→テスト/検証→修正→次** を高速に回し、knomuraの手作業を最小化するための前提を整理します。

## 重要：この環境の制約（先に結論）
このCodex実行環境のターミナルは **外部ネットワークへ接続できません**。
そのため、次のような操作は私が直接できません。

- `git push`（GitHubへ反映）
- Supabase/Googleなど外部APIへ直接アクセスするCLI操作

ただし、**ローカルでのビルド/型チェック**や、**GitHub Actions側での自動化**は問題なく進められます。

## 最小セット（これが揃えば回せる）
### 1) GitHub（必須）
- リポジトリがGitHubに存在すること
- GitHub Actionsが有効であること
- Secretsが登録済みであること（詳細は `docs/04_ENV_AND_SECRETS.md`）

### 2) Supabase（必須）
- Supabaseプロジェクトが作成済みであること
- DBが初期化済みであること（`supabase/schema.sql` / `supabase/rls.sql` / `supabase/storage.sql` / `supabase/bootstrap.sql`）

### 3) ローカルのフロント環境変数（必須）
`.env.local` に以下が入っていること
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 運用フロー（knomuraの作業は最小）
### A) 私がやること（基本）
1. 実装
2. ローカルで `npm run typecheck` / `npm run build` を実行して壊れていないことを確認
3. ブランチにコミット（例: `codex/...`）

### B) knomuraにお願いする最小作業（必要な時だけ）
外部ネットワーク制約により、**GitHubへ反映（push）だけ**はお願いすることがあります。

```bash
git push
```

※コマンドが不安な場合は「そのまま貼り付けて実行」でOKな形にして渡します。

## 自動化で何ができるか（現時点）
### 1) CI（常に自動）
- `npm run typecheck`
- `npm run build`

### 2) Supabase DB反映（手動実行の自動化）
GitHub Actionsの `Supabase Apply SQL` を1クリックで実行できます。
- `supabase/schema.sql`
- `supabase/storage.sql`
- `supabase/rls.sql`

## 次にやりたい自動化（必要になったら追加）
### E2E（画面操作の自動テスト）
- Playwright等を導入し、ログイン→投稿→受信箱などを自動で確認
- これは追加依存（npm install）が必要になるため、導入タイミングで調整します

