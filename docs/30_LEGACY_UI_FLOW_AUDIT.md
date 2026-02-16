# 旧導線・残存文言監査レポート（2026-02-16）

## 1) コード/実装側の確認結果

### 1-1. UI本体での残存要素
- `components/`, `services/`, `App.tsx`, `contexts/`, `supabase/functions/` では、対象の旧文言は確認できませんでした。
  - `店舗情報（MEO）`
  - `SNS連携設定`
  - `店舗グループ`
  - `SQL Editor`
  - `統合受信箱`（表示文言）
- 旧機能フローに関する参照は以下のみ（意図的）:
  - `scripts/audit/e2e/storeGroupsRemoved.spec.ts`（UI消失監視）
  - `scripts/docs/generateErd.ts`（ERD生成時のテーブル列挙）
  - `scripts/audit/dbAuditPhase1.ts`（`store_groups` / `store_group_stores` を監査対象として維持）

### 1-2. 例外として残すべき実装
- `store_groups` / `store_group_stores` は DB互換のため保持（設計上、将来の拡張用に残置）。
- `docs/` 配下の過去計画/検証記録内の旧文言は履歴文脈として残置。

## 2) 監査で見つかった残存文言（主にドキュメント）

| 分類 | パターン | 該当主要ファイル | 対応方針 |
|---|---|---|---|
| 保守対象外（履歴） | `店舗グループ`, `store_groups` | `docs/05_RUNBOOK_KNOMURA.md`, `docs/10_IMPLEMENTATION_EXECUTION_PLAN_PHASE1_TO_PHASE3.md`, `docs/12_P1_FINAL_VERIFICATION_RUNBOOK.md`, `docs/11_TEST_STRATEGY_AND_QUALITY_RULES.md`, `docs/13_SYSTEM_SURFACE_STATUS_MATRIX.md`, `docs/24_GROUPS_AND_STORES_EXPLAINER.md` | 現行運用から外した旧機能の履歴。`store_groups` はDB側互換用途で残置 |
| 保守対象外（環境手順） | `SQL Editor` | `docs/05_RUNBOOK_KNOMURA.md`、`docs/12_P1_FINAL_VERIFICATION_RUNBOOK.md` | Supabase側手順として妥当なため現状維持 |
| 表記更新候補（UI説明） | `統合受信箱` | `docs/00_MVP_DEFINITION.md`, `docs/06_RELEASE_CHECKLIST.md`, `docs/05_RUNBOOK_KNOMURA.md`, `docs/12_P1_FINAL_VERIFICATION_RUNBOOK.md` | これらは旧版資料の文言。現行UI運用資料での表記統一要否を別途確認 |

## 3) 旧導線除去アクションの現状

- コード側の主要導線（新規投稿/ユーザー管理/設定周り）は除去済み。Phase1監査シナリオ中の店舗グループ実行処理は
  - `scripts/audit/e2e/phase1.spec.ts` から削除し、`User controls + CSV import` に簡素化済み。
- `scripts/audit/e2e/storeGroupsRemoved.spec.ts` は、店舗グループUIが残っていないことを継続監視するテストとして維持。

## 4) 次アクション（任意）

1. 今回は「実装から除去」までを完了。今後、運用向け公開ドキュメントを統一する場合は該当履歴文書を順次更新。
2. 将来、`store_groups` を完全削除する場合は、`23_DATABASE_ERD.md`, `dbAuditPhase1.ts`, `generateErd.ts`, `13_SYSTEM_SURFACE_STATUS_MATRIX.md` の該当参照も同時更新。
