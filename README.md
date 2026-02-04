# TEPPEN MEO

店舗オーナー/代理店向けの、MEO（Googleビジネスプロフィール）とSNS運用を統合管理するWebアプリです。

## 現状（重要）
このリポジトリは **UIのモックアップが中心**で、データ永続化や外部API連携（GBP/SNS）はこれから実装します。
- モックデータ: `constants.ts`
- 簡易ログイン: `localStorage` ベース（デモ用）

機能の“実装済み/モック”の区別は `FEATURES.md` を参照してください。

## ローカル起動
前提: Node.js

1. 依存関係のインストール:
   `npm install`
2. 環境変数を設定:
   - `.env.example` を参考に `.env.local` を作成
   - （任意）AI文章生成を使う場合は `GEMINI_API_KEY` を設定
   - （MVP以降）Supabase接続時は `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定
3. 起動:
   `npm run dev`

## MVP計画ドキュメント（モック脱却）
MVPの定義・設計・手順書は `docs/` に集約しています。
- `docs/00_MVP_DEFINITION.md`
- `docs/01_ROLES_PERMISSIONS.md`
- `docs/02_DATA_MODEL_AND_RLS.md`
- `docs/03_INTEGRATION_GBP.md`
- `docs/04_ENV_AND_SECRETS.md`
- `docs/05_RUNBOOK_KNOMURA.md`
- `docs/06_RELEASE_CHECKLIST.md`

## 今後の改善
MVP完了後のロードマップは `IMPROVEMENTS.md` を参照してください。
