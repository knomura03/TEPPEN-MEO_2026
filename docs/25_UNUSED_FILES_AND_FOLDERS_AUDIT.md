# 不要ファイル・フォルダ調査レポート

- 実施日: 2026-02-17（再確認実施）
- 対象: `/Users/nomurakatsuya/.codex/worktrees/b98f/TEPPEN-MEO_2026`

## サマリ

- 高確度の削除候補: **0ファイル**（※ `landing.spec.ts` は別コミットで既に削除済み）
- 条件付きの削除候補（機能OFF由来）: **0ファイル**
- ローカル生成物（削除して問題なし）: **3フォルダ + 空ディレクトリ10件**

## 今回の実施結果

- ✅ 削除済み: `scripts/audit/e2e/landing.spec.ts`
- ✅ クリーンアップ済み: `dist`, `output`, `test-results`
- ⏸ 条件付き: なし（店舗グループ機能は実装経路上すべて撤去）

## 調査方法

1. `package.json` の scripts 参照を起点に、`scripts/` 配下の到達性を確認。
2. `index.tsx` / `App.tsx` 起点で `components/` `services/` `contexts/` の import 到達性を確認。
3. 固定フラグで無効化されている機能（`showStoreGroupFeatures = false`）を抽出。
4. ローカル生成物フォルダ（`dist` `output` `test-results`）と空ディレクトリを確認。

## A. 高確度の削除候補（未参照）

| 種別 | パス | 根拠 | 推奨 |
|---|---|---|---|
| File | `scripts/audit/e2e/landing.spec.ts` | `package.json` scripts から未参照、他スクリプトからも参照なし | 不要なら削除 |

## B. 条件付きの削除候補（実行時に到達しない）

> 現在の実装方針（店舗グループUIを使わない）を維持する場合の候補です。

| 種別 | パス | 根拠 | 推奨 |
|---|---|---|---|
| File | `scripts/audit/e2e/storeGroupsRemoved.spec.ts` | 店舗グループUI非存在を監視 | 継続監視（回帰防止） |

## C. ローカル生成物（削除してOK）

| 種別 | パス | 備考 |
|---|---|---|
| Folder | `dist` | ビルド成果物（`.gitignore`対象） |
| Folder | `output` | 監査実行成果物（`.gitignore`対象） |
| Folder | `test-results` | Playwright結果（`.gitignore`対象） |

- 追加確認: `output/audit` 配下に **空ディレクトリ 10件** 存在

## 結論（いま着手すべき順）

1. `dist` / `output` / `test-results` は定期クリーンアップ対象として運用（コミット対象外）。
2. `store_groups` を完全削除する判断時は、`23_DATABASE_ERD.md` / `dbAuditPhase1.ts` / `generateErd.ts` / `13_SYSTEM_SURFACE_STATUS_MATRIX.md` の整合更新を同時実施。
