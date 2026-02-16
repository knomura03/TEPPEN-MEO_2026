# フル監査 / デプロイ可否ゲート運用手順

最終更新: 2026-02-16

## 1. 目的
- 監査を1コマンドで実行し、`本番デプロイ可能か` を機械判定するための手順です。
- 手動実行時に不要な自動commit/pushを発生させない運用を固定します。

## 2. 実行コマンド

### 2-1. 監査ユーザー再生成（毎回）
```bash
npm run audit:bootstrap:users
```

### 2-2. フル監査（A/B/C + deploy-ready）
```bash
npm run audit:full
```

### 2-3. デプロイ可否だけ確認したい場合
```bash
npm run audit:deploy-ready
```

## 3. 実行順（`audit:full` 内部）
1. `audit:static`
2. `audit:db:phase1..4`
3. `audit:db:users`
4. `audit:db:management-units`
5. `audit:db:billing-store-plans`
6. `audit:edge:jwt`
7. `audit:bootstrap:users`
8. `audit:api:user-provisioning`
9. `audit:e2e:phase1..4`
10. `audit:e2e:users`
11. `audit:e2e:header-multiselect`
12. `audit:e2e:multi-store-db-views`
13. `audit:e2e:platform-single-store`
14. `audit:e2e:store-management-user-edit`
15. `audit:deploy-ready`

## 4. 出力先
- フル監査: `output/audit/full/<timestamp>/summary.json`
- deploy-ready: `output/audit/_adhoc/deploy_readiness/<timestamp>/deployReadiness.result.json`
- 失敗時ログ: 同フォルダ内の `*.stdout.log`, `*.stderr.log`

## 5. 失敗時の切り分け
- `audit:static` 失敗: `typecheck` / `build` / `smoke:contracts` のログを確認
- `audit:bootstrap:users` 失敗: `output/audit/.../bootstrapUsers.result.json` と `*.error.log`
- `audit:e2e:*` 失敗: `test-results/.../trace.zip` を `npx playwright show-trace` で確認
- `audit:deploy-ready` 失敗:
  - `migration mismatch` → `supabase migration list --linked` を確認
  - `required function is missing/not ACTIVE` → `supabase functions list --project-ref <ref>` を確認
  - `edge JWT` 失敗 → `npm run audit:edge:jwt` のログを確認

## 6. `AUDIT_AUTO_COMMIT` の使い分け
- 手動実行（推奨）: `AUDIT_AUTO_COMMIT=0`（デフォルト）
  - `audit:phase*` 実行時に `docs/14` の自動commit/pushは行いません。
- CI実行のみ:
  - `AUDIT_AUTO_COMMIT=1` を明示した場合に限り、自動commit/pushを許可します。

## 7. 最新実績
- 実行日: 2026-02-16
- コマンド: `npm run audit:full`
- 結果: PASS（`output/audit/full/20260216_144007/summary.json`）
- `audit:deploy-ready`: `ready=true`
