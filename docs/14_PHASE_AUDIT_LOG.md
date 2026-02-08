# TEPPEN MEO: Phase Audit Log (AUTO)

最終更新: 2026-02-09

このドキュメントは `npm run audit:phase1` などの監査ランナーが自動追記します。

運用ルール:
- 監査結果は原則ここに追記し、監査ランナーが自動で `commit/push` まで行います
- 監査コミットと機能修正コミットは混ぜません（修正が必要な場合は別コミットで対応）
- 詳細ログ/成果物は `output/audit/<phase>/<timestamp>/` を参照してください（Git管理しません）

---

## Entries

## 2026-02-08T18:28:04.668Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `02cd773e6aa51f927974d4037622d9dad73cdb5b`
- output: `output/audit/phase1/20260209_032804`
- A(static): PASS (run typecheck=OK(2.5s), run build=OK(3.1s), run smoke:contracts=OK(142ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_032804/B_db`
- preflight(users): FAIL: Failed to provision manager: Edge Function returned a non-2xx status code
  - logs: `output/audit/phase1/20260209_032804/preflight_users`
- C(e2e): SKIPPED

## 2026-02-08T18:30:43.686Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `c1b1421c312a80b47306309c3055ce04065dc9f4`
- output: `output/audit/phase1/20260209_033043`
- A(static): PASS (run typecheck=OK(2.8s), run build=OK(3.2s), run smoke:contracts=OK(166ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_033043/B_db`
- preflight(users): FAIL: Failed to provision manager: Edge Function returned a non-2xx status code (status=401)
  - logs: `output/audit/phase1/20260209_033043/preflight_users`
- C(e2e): SKIPPED

## 2026-02-08T18:32:42.093Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `d014e97fc51812798955eb88d92a0ed6dc9af393`
- output: `output/audit/phase1/20260209_033242`
- A(static): PASS (run typecheck=OK(2.5s), run build=OK(3.2s), run smoke:contracts=OK(171ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_033242/B_db`
- preflight(users): FAIL: Failed to provision manager: Edge Function returned a non-2xx status code (status=401)
  - logs: `output/audit/phase1/20260209_033242/preflight_users`
- C(e2e): SKIPPED

