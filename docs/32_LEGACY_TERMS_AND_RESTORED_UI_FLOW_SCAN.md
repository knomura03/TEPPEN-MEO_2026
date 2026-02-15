# 旧導線・残存文言 スキャン結果（実装再確認: 2026-02-17）

本スキャンは「UI操作に影響する旧フローがまだ残っていないか」を確認するため、  
主対象語を `components`, `services`, `contexts`, `supabase/functions`, `docs` 全体で再検索した結果です。

## スキャン対象語
- `店舗情報（MEO）`
- `SNS連携設定`
- `店舗グループ`
- `store_groups`
- `SQL Editor`
- `統合受信箱`

## 実装側（コード）
- `components`
- `services`
- `contexts`
- `App.tsx`
- `supabase/functions`
- `scripts/audit`（E2Eを除く）

の範囲では、上記語を **UIとして解釈される実装上の導線として残存する形では検出されませんでした。

※例外として、`store_groups` は以下のみで「DB互換資産としての参照」に限定されます。
- `supabase/migrations/202602060008_p1_store_group_management.sql`
- `scripts/docs/generateErd.ts`
- `scripts/audit/dbAuditPhase1.ts`

## ドキュメント側
旧語が残る文書は、主に以下に限定されます（履歴/保守資料として意図的に保持）。
- `docs/05_RUNBOOK_KNOMURA.md`
- `docs/10_IMPLEMENTATION_EXECUTION_PLAN_PHASE1_TO_PHASE3.md`
- `docs/11_TEST_STRATEGY_AND_QUALITY_RULES.md`
- `docs/12_P1_FINAL_VERIFICATION_RUNBOOK.md`
- `docs/24_GROUPS_AND_STORES_EXPLAINER.md`（用語説明）
- `docs/30_LEGACY_UI_FLOW_AUDIT.md`
- `docs/31_REMAINING_LEGACY_FLOW_OCCURRENCES.md`
- `docs/13_SYSTEM_SURFACE_STATUS_MATRIX.md`（（廃止）明示）

## Supabase側（SQL運用）
- `supabase/rls.sql` や `supabase/bootstrap.sql` に `SQL Editor` 文言が残るのは、運用手順の説明文上であり、アプリUI導線ではありません。
- `supabase/README.md` も、管理者手順の文脈上の記載です。

## 判定
- **UI実装での旧導線残存: なし（要件どおり）**
- **DB互換資産として `store_groups` は保持: あり（意図的）**
- **公開運用の手順更新が必要か**: `docs/05`, `docs/12`, `docs/24` は履歴文書寄り、順次上書き更新で対応可能。
