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

## 2026-02-08T19:13:13.431Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `994d8db79a4b248217ccca50fb9b1e93888dda72`
- output: `output/audit/phase1/20260209_041313`
- A(static): PASS (run typecheck=OK(2.3s), run build=OK(3.3s), run smoke:contracts=OK(177ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_041313/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_041313/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_041313/C_e2e`)

## 2026-02-08T19:19:43.358Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `55e1f5749dc4886fc2b0b9e7fb4a0e3ef274b964`
- output: `output/audit/phase1/20260209_041943`
- A(static): PASS (run typecheck=OK(2.4s), run build=OK(3.1s), run smoke:contracts=OK(169ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_041943/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_041943/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_041943/C_e2e`)

## 2026-02-08T19:21:47.387Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `86fc9565cafdb3d4bc6c7601c1be8f21143a1018`
- output: `output/audit/phase1/20260209_042147`
- A(static): PASS (run typecheck=OK(2.4s), run build=OK(3s), run smoke:contracts=OK(171ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_042147/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_042147/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_042147/C_e2e`)

## 2026-02-08T19:23:17.077Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `96bd23386125c035b554f753cf2df8674186995a`
- output: `output/audit/phase1/20260209_042317`
- A(static): PASS (run typecheck=OK(2.5s), run build=OK(3.5s), run smoke:contracts=OK(143ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_042317/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_042317/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_042317/C_e2e`)

## 2026-02-08T19:28:15.879Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `9958c76d824c487b1b74b1c33ec36c5ddf580dbe`
- output: `output/audit/phase1/20260209_042815`
- A(static): PASS (run typecheck=OK(2.4s), run build=OK(3.1s), run smoke:contracts=OK(173ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_042815/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_042815/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_042815/C_e2e`)

## 2026-02-08T19:35:56.061Z PHASE1 PASS

- command: `npm run audit:phase1`
- commit: `5857440ece4028c97a43521c304aac704dca0c46`
- output: `output/audit/phase1/20260209_043556`
- A(static): PASS (run typecheck=OK(2.9s), run build=OK(3.5s), run smoke:contracts=OK(221ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_043556/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_043556/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase1/20260209_043556/C_e2e`)

## 2026-02-08T20:42:18.895Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `f3c75eff201ba8cf09eba82928a5341db647f280`
- output: `output/audit/phase1/20260209_054218`
- A(static): PASS (run typecheck=OK(2.7s), run build=OK(3.5s), run smoke:contracts=OK(162ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_054218/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_054218/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_054218/C_e2e`)

## 2026-02-08T20:48:19.534Z PHASE1 PASS

- command: `npm run audit:phase1`
- commit: `9e4d060abb50e68f3e8860cb7006276d38d3d13f`
- output: `output/audit/phase1/20260209_054819`
- A(static): PASS (run typecheck=OK(2.7s), run build=OK(3.5s), run smoke:contracts=OK(173ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_054819/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_054819/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase1/20260209_054819/C_e2e`)

## 2026-02-08T21:07:54.468Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `b86561238b33d18469dd59c3f93b28c9ecb348e5`
- output: `output/audit/phase2/20260209_060754`
- A(static): PASS (run typecheck=OK(2.7s), run build=OK(3.6s), run smoke:contracts=OK(186ms))
- B(db): FAIL (brand_kits.columns code=PGRST205: Could not find the table 'public.brand_kits' in the schema cache)
  - logs: `output/audit/phase2/20260209_060754/B_db`
- preflight(users): SKIPPED
- C(e2e): SKIPPED

## 2026-02-08T21:09:48.997Z PHASE1 PASS

- command: `npm run audit:phase1`
- commit: `f5f41c7a1c81764a609d1f15864a52c8d7feae16`
- output: `output/audit/phase1/20260209_060948`
- A(static): PASS (run typecheck=OK(3.8s), run build=OK(3.8s), run smoke:contracts=OK(183ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_060948/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_060948/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase1/20260209_060948/C_e2e`)

## 2026-02-08T21:14:35.369Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `5ae2970caf815768be80ae0f6e0ae17eb254c9a1`
- output: `output/audit/phase2/20260209_061435`
- A(static): PASS (run typecheck=OK(2.5s), run build=OK(3.1s), run smoke:contracts=OK(196ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_061435/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_061435/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_061435/C_e2e`)

## 2026-02-08T21:35:05.361Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `101131331d9e05d9d143ef8cf2493f0a3f9346f5`
- output: `output/audit/phase2/20260209_063505`
- A(static): PASS (run typecheck=OK(65.4s), run build=OK(2.7s), run smoke:contracts=OK(141ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_063505/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_063505/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_063505/C_e2e`)

## 2026-02-08T21:37:49.828Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `c34d2fa7564edfcd33046b39daffde8c6da05818`
- output: `output/audit/phase2/20260209_063749`
- A(static): PASS (run typecheck=OK(2s), run build=OK(2.7s), run smoke:contracts=OK(142ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_063749/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_063749/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_063749/C_e2e`)

## 2026-02-08T21:39:23.845Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `bb126772789d9a7e547d017297a24bc545d7ee4b`
- output: `output/audit/phase2/20260209_063923`
- A(static): PASS (run typecheck=OK(2.2s), run build=OK(2.7s), run smoke:contracts=OK(136ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_063923/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_063923/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_063923/C_e2e`)

## 2026-02-08T21:43:01.044Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `2feac5f19b63f215bc4bdca0608786d6f67fc230`
- output: `output/audit/phase2/20260209_064301`
- A(static): PASS (run typecheck=OK(2.1s), run build=OK(2.7s), run smoke:contracts=OK(136ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_064301/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_064301/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_064301/C_e2e`)

## 2026-02-08T22:01:56.271Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `269497cfe69bd394198ed7fa3430fc514faf5e6a`
- output: `output/audit/phase2/20260209_070156`
- A(static): PASS (run typecheck=OK(2.1s), run build=OK(2.7s), run smoke:contracts=OK(142ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_070156/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_070156/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_070156/C_e2e`)

## 2026-02-08T22:03:05.602Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `794ae8613a80b1c579e891f1ab1b13ead84c785d`
- output: `output/audit/phase2/20260209_070305`
- A(static): PASS (run typecheck=OK(2.1s), run build=OK(2.6s), run smoke:contracts=OK(137ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_070305/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_070305/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_070305/C_e2e`)

## 2026-02-08T22:20:10.354Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `c23d08314b9349be1a3752914d1df5fb2a0c0f12`
- output: `output/audit/phase2/20260209_072010`
- A(static): PASS (run typecheck=OK(2.2s), run build=OK(2.8s), run smoke:contracts=OK(138ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_072010/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_072010/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_072010/C_e2e`)

## 2026-02-08T22:38:51.319Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `b76159f50ce8d772612b156b383504c6baf23de8`
- output: `output/audit/phase2/20260209_073851`
- A(static): PASS (run typecheck=OK(2.2s), run build=OK(2.7s), run smoke:contracts=OK(136ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_073851/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_073851/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_073851/C_e2e`)

## 2026-02-08T23:46:48.231Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `1584c3713d874080f490874e31a4c034bf1ecbba`
- output: `output/audit/phase2/20260209_084648`
- A(static): PASS (run typecheck=OK(2.1s), run build=OK(2.8s), run smoke:contracts=OK(135ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_084648/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_084648/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_084648/C_e2e`)

## 2026-02-09T00:10:31.423Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `d414f979eae668ff4528def645d38b8040d3e313`
- output: `output/audit/phase2/20260209_091031`
- A(static): PASS (run typecheck=OK(2.3s), run build=OK(2.9s), run smoke:contracts=OK(136ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_091031/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_091031/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_091031/C_e2e`)

## 2026-02-09T00:11:42.947Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `8c9b23b27844adbcab27b5b757ad1f5175cd7315`
- output: `output/audit/phase2/20260209_091142`
- A(static): PASS (run typecheck=OK(2s), run build=OK(2.7s), run smoke:contracts=OK(137ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_091142/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_091142/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_091142/C_e2e`)

## 2026-02-09T00:15:19.648Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `ff5c364ed5b24cf812541e479c2de8c734dfda51`
- output: `output/audit/phase2/20260209_091519`
- A(static): PASS (run typecheck=OK(2.1s), run build=OK(2.7s), run smoke:contracts=OK(136ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_091519/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_091519/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_091519/C_e2e`)

## 2026-02-09T00:33:31.398Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `d606fea18514fdb25ab12c0a532e338351680f9f`
- output: `output/audit/phase2/20260209_093331`
- A(static): PASS (run typecheck=OK(2.2s), run build=OK(2.7s), run smoke:contracts=OK(136ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_093331/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_093331/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_093331/C_e2e`)

## 2026-02-09T00:35:17.372Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `cf67a9c994ebcae68d0020a66e4f453ec06fad4c`
- output: `output/audit/phase2/20260209_093517`
- A(static): PASS (run typecheck=OK(2.1s), run build=OK(2.7s), run smoke:contracts=OK(136ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_093517/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_093517/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_093517/C_e2e`)

## 2026-02-09T01:09:19.038Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `90a5e23c4a57b75a3c9d611ea38968ce588cb295`
- output: `output/audit/phase2/20260209_100919`
- A(static): PASS (run typecheck=OK(188.3s), run build=OK(2.8s), run smoke:contracts=OK(137ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_100919/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_100919/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_100919/C_e2e`)

## 2026-02-09T01:47:39.372Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `05f1179a7eb1b746fa885ccc1504ddbb3565ce03`
- output: `output/audit/phase2/20260209_104739`
- A(static): PASS (run typecheck=OK(2.9s), run build=OK(3.7s), run smoke:contracts=OK(162ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_104739/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_104739/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_104739/C_e2e`)

## 2026-02-09T01:50:44.469Z PHASE2 FAIL

- command: `npm run audit:phase2`
- commit: `68e31e1a6ff5df57c93644240375219f7ddb0862`
- output: `output/audit/phase2/20260209_105044`
- A(static): PASS (run typecheck=OK(2.6s), run build=OK(3.1s), run smoke:contracts=OK(159ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_105044/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_105044/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase2/20260209_105044/C_e2e`)

## 2026-02-09T01:52:19.101Z PHASE2 PASS

- command: `npm run audit:phase2`
- commit: `c1cb09b5b172e11110c2bfae45373a8321405601`
- output: `output/audit/phase2/20260209_105219`
- A(static): PASS (run typecheck=OK(2.3s), run build=OK(3s), run smoke:contracts=OK(140ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_105219/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_105219/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase2/20260209_105219/C_e2e`)

## 2026-02-09T02:01:37.260Z PHASE1 PASS

- command: `npm run audit:phase1`
- commit: `ee386dfe91dc4c867b549df7f84729e1268c2def`
- output: `output/audit/phase1/20260209_110137`
- A(static): PASS (run typecheck=OK(3.3s), run build=OK(4s), run smoke:contracts=OK(171ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_110137/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_110137/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase1/20260209_110137/C_e2e`)

## 2026-02-09T02:03:13.714Z PHASE2 PASS

- command: `npm run audit:phase2`
- commit: `817e8f9e4ea86f16155207a174e9cfebac8900b2`
- output: `output/audit/phase2/20260209_110313`
- A(static): PASS (run typecheck=OK(3s), run build=OK(3.5s), run smoke:contracts=OK(164ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_110313/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_110313/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase2/20260209_110313/C_e2e`)

## 2026-02-09T02:18:03.856Z PHASE3 FAIL

- command: `npm run audit:phase3`
- commit: `d36bd3be4f9a88b3039dd19cad254c8e341ffbbf`
- output: `output/audit/phase3/20260209_111803`
- A(static): PASS (run typecheck=OK(5.8s), run build=OK(4.4s), run smoke:contracts=OK(309ms))
- B(db): PASS (8 checks)
  - logs: `output/audit/phase3/20260209_111803/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase3/20260209_111803/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase3/20260209_111803/C_e2e`)

## 2026-02-09T02:23:54.463Z PHASE3 FAIL

- command: `npm run audit:phase3`
- commit: `584552a47089495cf246e04a8bbff68a6741c858`
- output: `output/audit/phase3/20260209_112354`
- A(static): PASS (run typecheck=OK(3.2s), run build=OK(3.8s), run smoke:contracts=OK(193ms))
- B(db): PASS (8 checks)
  - logs: `output/audit/phase3/20260209_112354/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase3/20260209_112354/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase3/20260209_112354/C_e2e`)

## 2026-02-09T02:25:41.118Z PHASE3 FAIL

- command: `npm run audit:phase3`
- commit: `d0a305fb7d0eca344864e4f1abd9685456c5a39a`
- output: `output/audit/phase3/20260209_112541`
- A(static): PASS (run typecheck=OK(3.5s), run build=OK(4.7s), run smoke:contracts=OK(197ms))
- B(db): PASS (8 checks)
  - logs: `output/audit/phase3/20260209_112541/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase3/20260209_112541/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase3/20260209_112541/C_e2e`)

## 2026-02-09T02:27:31.441Z PHASE3 PASS

- command: `npm run audit:phase3`
- commit: `2a534133bb2a9356716ad9d9f359a592024f5f57`
- output: `output/audit/phase3/20260209_112731`
- A(static): PASS (run typecheck=OK(3.1s), run build=OK(3.9s), run smoke:contracts=OK(195ms))
- B(db): PASS (8 checks)
  - logs: `output/audit/phase3/20260209_112731/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase3/20260209_112731/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase3/20260209_112731/C_e2e`)

## 2026-02-09T02:41:09.575Z PHASE4 FAIL

- command: `npm run audit:phase4`
- commit: `cc6547d49b7378d3a00fd552fd3dfdccf2425d3c`
- output: `output/audit/phase4/20260209_114109`
- A(static): PASS (run typecheck=OK(3.1s), run build=OK(4.1s), run smoke:contracts=OK(211ms))
- B(db): FAIL (billing_plans.columns code=PGRST205: Could not find the table 'public.billing_plans' in the schema cache)
  - logs: `output/audit/phase4/20260209_114109/B_db`
- preflight(users): SKIPPED
- C(e2e): SKIPPED

## 2026-02-09T02:44:32.286Z PHASE2 PASS

- command: `npm run audit:phase2`
- commit: `840f7d0c5e2e3a2cb29ad082b28d3ca21509ffb9`
- output: `output/audit/phase2/20260209_114432`
- A(static): PASS (run typecheck=OK(45.9s), run build=OK(6.5s), run smoke:contracts=OK(288ms))
- B(db): PASS (15 checks)
  - logs: `output/audit/phase2/20260209_114432/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase2/20260209_114432/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase2/20260209_114432/C_e2e`)

## 2026-02-09T02:46:30.085Z PHASE1 FAIL

- command: `npm run audit:phase1`
- commit: `8ac24c76297e6c40494cfefcca80f833c75058d6`
- output: `output/audit/phase1/20260209_114630`
- A(static): PASS (run typecheck=OK(4.4s), run build=OK(5.9s), run smoke:contracts=OK(288ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_114630/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_114630/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase1/20260209_114630/C_e2e`)

## 2026-02-09T02:48:28.731Z PHASE1 PASS

- command: `npm run audit:phase1`
- commit: `cc1c7f4f235b5cf2f93aa755c4593afbfa0c4b93`
- output: `output/audit/phase1/20260209_114828`
- A(static): PASS (run typecheck=OK(3.6s), run build=OK(6.1s), run smoke:contracts=OK(400ms))
- B(db): PASS (13 checks)
  - logs: `output/audit/phase1/20260209_114828/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase1/20260209_114828/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase1/20260209_114828/C_e2e`)

## 2026-02-09T02:50:44.504Z PHASE3 PASS

- command: `npm run audit:phase3`
- commit: `2e4dea3c4b1188a655d360704abbac55399f184d`
- output: `output/audit/phase3/20260209_115044`
- A(static): PASS (run typecheck=OK(5.1s), run build=OK(6.8s), run smoke:contracts=OK(263ms))
- B(db): PASS (8 checks)
  - logs: `output/audit/phase3/20260209_115044/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase3/20260209_115044/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase3/20260209_115044/C_e2e`)

## 2026-02-09T02:52:38.440Z PHASE4 FAIL

- command: `npm run audit:phase4`
- commit: `b71680e47efbe4c05e60cf6ea0afd5181c7fb708`
- output: `output/audit/phase4/20260209_115238`
- A(static): PASS (run typecheck=OK(5.9s), run build=OK(5.7s), run smoke:contracts=OK(250ms))
- B(db): FAIL (billing_plans.columns code=PGRST205: Could not find the table 'public.billing_plans' in the schema cache)
  - logs: `output/audit/phase4/20260209_115238/B_db`
- preflight(users): SKIPPED
- C(e2e): SKIPPED

## 2026-02-09T04:22:53.686Z PHASE4 FAIL

- command: `npm run audit:phase4`
- commit: `817c85a32fb85a0d34d6fad0b49b634a45d03ce2`
- output: `output/audit/phase4/20260209_132253`
- A(static): PASS (run typecheck=OK(3.2s), run build=OK(4.2s), run smoke:contracts=OK(159ms))
- B(db): PASS (5 checks)
  - logs: `output/audit/phase4/20260209_132253/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase4/20260209_132253/preflight_users`
- C(e2e): FAIL(exit=1) (artifacts: `output/audit/phase4/20260209_132253/C_e2e`)

## 2026-02-09T04:55:53.192Z PHASE4 PASS

- command: `npm run audit:phase4`
- commit: `e5cf4568858158bcaba9f00b17c67271ea3adb2c`
- output: `output/audit/phase4/20260209_135553`
- A(static): PASS (run typecheck=OK(3.2s), run build=OK(3.9s), run smoke:contracts=OK(162ms))
- B(db): PASS (5 checks)
  - logs: `output/audit/phase4/20260209_135553/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase4/20260209_135553/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase4/20260209_135553/C_e2e`)

## 2026-02-09T05:24:12.248Z PHASE4 PASS

- command: `npm run audit:phase4`
- commit: `20dddfcd8a5d257f1604ab8995cdbae2917a00ad`
- output: `output/audit/phase4/20260209_142412`
- A(static): PASS (run typecheck=OK(3.3s), run build=OK(4.2s), run smoke:contracts=OK(198ms))
- B(db): PASS (5 checks)
  - logs: `output/audit/phase4/20260209_142412/B_db`
- preflight(users): PASS
  - logs: `output/audit/phase4/20260209_142412/preflight_users`
- C(e2e): PASS (artifacts: `output/audit/phase4/20260209_142412/C_e2e`)

