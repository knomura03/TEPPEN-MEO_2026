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

## 2026-02-08T18:35:01.619Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `ccbd24e6eef04d538a989264d4f7510638772459`
- output: `output/audit/phase1/20260209_033501`
- A(static): PASS (run typecheck=OK(2.3s), run build=OK(3.3s), run smoke:contracts=OK(166ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_033501/B_db`
- preflight(users): FAIL: Failed to provision manager: {"code":401,"message":"Invalid JWT"} (status=401)
  - logs: `output/audit/phase1/20260209_033501/preflight_users`
- C(e2e): SKIPPED

## 2026-02-08T18:37:16.661Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `461473a52b0f378eb121ac8d942316143cf9553d`
- output: `output/audit/phase1/20260209_033716`
- A(static): PASS (run typecheck=OK(2.4s), run build=OK(3.3s), run smoke:contracts=OK(171ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_033716/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_033716/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_033716/C_e2e`)

## 2026-02-08T18:46:04.941Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `f62a50d04bc30fac5e28742d80ebcb7b60e6278c`
- output: `output/audit/phase1/20260209_034604`
- A(static): PASS (run typecheck=OK(2.6s), run build=OK(3.1s), run smoke:contracts=OK(177ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_034604/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_034604/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_034604/C_e2e`)

## 2026-02-08T18:58:22.102Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `f8500b1dd90dbcb451f858e6bcbd137f5adf9bef`
- output: `output/audit/phase1/20260209_035822`
- A(static): PASS (run typecheck=OK(2.4s), run build=OK(3.1s), run smoke:contracts=OK(144ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_035822/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_035822/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_035822/C_e2e`)

## 2026-02-08T19:02:40.604Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `11e547a924dfe8e9d0806031a4db65bf3e370888`
- output: `output/audit/phase1/20260209_040240`
- A(static): PASS (run typecheck=OK(2.3s), run build=OK(3s), run smoke:contracts=OK(148ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_040240/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_040240/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_040240/C_e2e`)

## 2026-02-08T19:08:53.265Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `6996d8b0e09397d481e7211c18d9a6da3552c3ac`
- output: `output/audit/phase1/20260209_040853`
- A(static): PASS (run typecheck=OK(2.4s), run build=OK(3.2s), run smoke:contracts=OK(177ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_040853/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_040853/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_040853/C_e2e`)

