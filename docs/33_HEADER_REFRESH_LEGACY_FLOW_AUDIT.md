# ヘッダー刷新対応：旧導線・旧文言スキャン結果（現時点）

最終更新: 2026-02-16

## 1. スキャン方針
- 対象: `components`, `services`（アプリ実装）と `docs`（ドキュメント）
- 対象語:  
  `store_groups` / `店舗グループ` / `店舗情報（MEO）` / `SNS連携設定` / `SQL Editor` / `統合受信箱`

## 2. 実装側（components/services）スキャン結果
- 0件（対象語のUI/サービス実装上の残存なし）
- 旧UI/文言は以下で継続確認済み:
  - `scripts/audit/e2e/storeGroupsRemoved.spec.ts`（店舗グループUIが現行画面に出ないことを回帰監視）
  - `components/HeaderScopeSelectors.tsx` / `components/ui/MultiSelectDropdown.tsx`（新規ヘッダー導線）
  - `components/SettingsView.tsx`（`店舗情報（MEO）`・`SNS連携設定`タブは削除済み）

## 3. ドキュメント側（残存一覧）
対象語は主に過去実装・運用手順文書に残っているため、アプリ運用上の回帰リスクは低いが、将来整理対象:
- `docs/05_RUNBOOK_KNOMURA.md`  
  - `SQL Editor` / `店舗情報（MEO）` / `店舗グループ` が多数残存
- `docs/10_IMPLEMENTATION_EXECUTION_PLAN_PHASE1_TO_PHASE3.md`  
  - 店舗グループUI方針・P1-09の歴史的記載
- `docs/11_TEST_STRATEGY_AND_QUALITY_RULES.md`
- `docs/12_P1_FINAL_VERIFICATION_RUNBOOK.md`
- `docs/13_SYSTEM_SURFACE_STATUS_MATRIX.md`
- `docs/24_GROUPS_AND_STORES_EXPLAINER.md`（旧語の説明含む）
- `docs/30_LEGACY_UI_FLOW_AUDIT.md` / `docs/31_REMAINING_LEGACY_FLOW_OCCURRENCES.md` / `docs/32_LEGACY_TERMS_AND_RESTORED_UI_FLOW_SCAN.md`

## 4. 方針（確定）
- **アプリ実装で旧文言を排除する**: 済
- **DB互換資産（`store_groups` / `store_group_stores`）は監査/ERD上のみ維持**: 方針維持
- **運用ドキュメントの旧文言は別回で段階的クリーンアップ**: 可能なら後続タスクで

## 5. 次アクション（任意）
1. 上記ドキュメントのうち現行運用資料向けに必要な部分のみ再編集
2. 旧語がUI要件に影響しないことを `docs/18_UI_COPY_STYLE_GUIDE.md` の表記ガイドに反映
3. 本監査ファイルの定期実行（playwright + rgスクリプト）をCI/監査に追加
