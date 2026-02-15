# 旧導線・残存文言 スキャン結果（最終更新: 2026-02-17）

## スキャン条件
- 対象語: `店舗情報（MEO）`, `SNS連携設定`, `店舗グループ`, `store_groups`, `統合受信箱`, `SQL Editor`
- 対象外: `docs/30_LEGACY_UI_FLOW_AUDIT.md`, `docs/31_REMAINING_LEGACY_FLOW_OCCURRENCES.md`

## コード/実装
- `components`, `services`, `contexts`, `supabase`, `App.tsx`, `scripts`（`e2e`を除く）
  - 上記語のヒット: 0件（旧導線は実装側で見当たらず）
  - `store_groups` は監査/設計資産での参照のみ確認:
    - `scripts/audit/dbAuditPhase1.ts`（監査上の継承参照）
    - `scripts/docs/generateErd.ts`（ERD抽出の履歴）
    - `supabase/migrations/202602060008_p1_store_group_management.sql`（DB互換保持）

## ドキュメント（残存）

- **履歴・手順系（更新対象外）**
  - `docs/05_RUNBOOK_KNOMURA.md`: `SQL Editor`, `店舗情報（MEO）`, `店舗グループ`
  - `docs/06_RELEASE_CHECKLIST.md`: `統合受信箱`
  - `docs/12_P1_FINAL_VERIFICATION_RUNBOOK.md`: `SQL Editor`, `店舗情報`, `店舗グループ`
  - `docs/10_IMPLEMENTATION_EXECUTION_PLAN_PHASE1_TO_PHASE3.md`: `店舗グループ`, `統合受信箱`
  - `docs/11_TEST_STRATEGY_AND_QUALITY_RULES.md`: `店舗グループ`, `統合受信箱`
  - `docs/00_MVP_DEFINITION.md`: `統合受信箱`

- **参照資料（現行仕様との整合を維持）**
  - `docs/13_SYSTEM_SURFACE_STATUS_MATRIX.md`: `（廃止）店舗グループ一括投稿/一括設定` を注記として保持
  - `docs/23_DATABASE_ERD.md`: `store_groups`, `store_group_stores`（DB互換維持の説明）
  - `docs/24_GROUPS_AND_STORES_EXPLAINER.md`: 用語説明で `店舗グループ` を残置
  - `docs/18_UI_COPY_STYLE_GUIDE.md`: `統合受信箱` → `受信箱`の文言更新方針を明記

## 対応方針
- `settings` 旧画面（`店舗情報（MEO）`,`SNS連携設定`）は実装・導線上から除去済み。
- `store_groups` は引き続き DB互換用途として保持し、UI導線は現行では使用しない。
- これらは実装要件に影響しないが、公開向け手順書を最新版に揃える場合は別途対象を上書き更新。

## 次ステップ
- 詳細な再スキャン結果（文言がコード側から消えたことと、残留先を明確化）については `docs/32_LEGACY_TERMS_AND_RESTORED_UI_FLOW_SCAN.md` を参照。
- 引き続き `store_groups` は UI から呼ばれない状態を維持し、必要時に `SUPABASE` 側で再確認。
- 実装側: 旧文言なし
- ドキュメント: 旧資料として残置。公開向け資料は必要に応じて順次 `受信箱`・`グループ管理`・`店舗管理`へ更新。
