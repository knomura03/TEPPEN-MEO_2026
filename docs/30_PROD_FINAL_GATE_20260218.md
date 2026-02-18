# 本番前 最終ゲート結果（2026-02-18）

## 1. 実施サマリ
- 結論: **本番デプロイ可（deploy-ready = true）**
- 主要3導線の手動スモーク（投稿 / 受信箱 / ユーザー招待）を再実施
- SMOKEで作成したテストデータは実行後に削除済み

## 2. 実施結果（機械監査）

### 2.1 監査ユーザー前提
- コマンド: `npm run audit:bootstrap:users`
- 結果: `ok: true`

### 2.2 ロール別E2E
- 実施:
  - `npm run audit:e2e:sidebar-rbac`
  - `npm run audit:e2e:users`
  - `npm run audit:e2e:user-create-requires-group-store`
  - `npm run audit:e2e:existing-email-rejected`
  - `npm run audit:e2e:attach-existing-user`
  - `npm run audit:e2e:manager-group-rbac`
  - `npm run audit:e2e:invite`
  - `npm run audit:e2e:invite-manager`
  - `npm run audit:e2e:store-management-user-edit`
- 結果: **全PASS**
- 備考: `sidebar-rbac` は USERの最新仕様（店舗管理を表示）へテストを更新

### 2.3 予約投稿の時刻到達検証
- 実施内容:
  - `status=SCHEDULED` + `approval_status=APPROVED` + `scheduled_at` を過去時刻で投稿作成
  - `scheduled-post-publisher` を実行
  - 投稿の `status` 変化を確認
- 結果:
  - `dueCount: 1 / processedCount: 1 / successCount: 1`
  - 対象投稿: `SCHEDULED -> PUBLISHED`
  - 検証後に投稿は削除済み

### 2.4 デプロイ可否ゲート
- コマンド: `npm run audit:deploy-ready`
- 結果:
  - `ready: true`
  - `blockingIssues: []`
  - `diagnostics`: migration/functions/edge-jwt probe すべて正常

### 2.5 追加ゲート（主要回帰）
- コマンド:
  - `npm run audit:edge:jwt`
  - `npm run audit:e2e:phase1`
- 結果:
  - Edge JWT probe: **PASS**
  - Phase1 E2E: **2/2 PASS**

## 3. 手動スモーク（主要3導線）
- 投稿: 新規投稿の確認ダイアログ動作と投稿一覧反映を確認
- 受信箱: 同期ボタン実行を確認（Invalid JWT は再現せず）
- ユーザー招待: 招待URLコピー導線を確認

## 4. SMOKEデータのクリーンアップ
- ユーザー:
  - `smoke.invite.20260218.1805@example.com` を完全削除
- 投稿:
  - `[SMOKE]` で検索し、該当3件を一括削除
- 現在状態:
  - `[SMOKE]` 検索結果 0件

## 5. 24時間監視項目（本番反映直後）
以下を `+0h / +2h / +6h / +24h` の4回で確認する。

1. 認証・権限
- `npm run audit:e2e:sidebar-rbac`
- `npm run audit:e2e:users`

2. 投稿実行系
- `npm run audit:e2e:phase1`
- 予約投稿がある場合は `scheduled-post-publisher` の処理件数を確認

3. 受信箱・同期
- 受信箱同期のトーストで `Invalid JWT` が出ないことを確認

4. デプロイ健全性
- `npm run audit:edge:jwt`
- `npm run audit:deploy-ready`

5. 異常時の切り分け
- 401系: JWT到達性（`audit:edge:jwt`）
- 403系: ロール/RLS（`audit:e2e:users` + `docs/22_ROLE_ACCESS_MATRIX.md`）
- 同期不達: プラットフォーム接続状態（DISCONNECTED/ERROR）を店舗単位で確認
