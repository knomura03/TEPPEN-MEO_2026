# TEPPEN MEO：画面/ボタン/機能/DB接続 状態台帳（正本）

最終更新: 2026-02-10（UI文言/ガイド順/メニュー順序管理・アンケート拡張反映）

## 0. 運用ルール（必須）
- この台帳は、実装・修正・設定変更のたびに**同一作業内で更新**する。
- 更新対象があるのに本書が更新されていない変更は、レビュー不可とする。
- ステータスは推測で書かず、コードまたは実環境確認に基づいて更新する。
- Supabase本番環境の実配備状態（Function配備有無など）は、確認できた時点で本書へ反映する。

## 1. ステータス凡例
- `CONNECTED`: DB/APIと実接続で動作する（フォールバックなし）
- `HYBRID`: 実接続 + 未設定時フォールバック（モック/デモ）
- `MOCK_ONLY`: モック表示のみ（実データ未接続）
- `UI_ONLY`: 画面のみ存在し、保存/連携処理は未接続
- `CONDITIONAL`: コード実装済みだが、外部設定（Edge Functions/Secrets等）完了で有効化
- `NOT_IMPLEMENTED`: ロードマップ上は定義済みだが未実装

## 2. 画面・機能マトリクス
| ID | 画面/領域 | UI/ボタン/機能 | ステータス | 接続先（DB/API/Function） | モック/注意点 | フェーズ |
|---|---|---|---|---|---|---|
| AUTH-01 | ログイン | メール/パスワードログイン | HYBRID | Supabase Auth, `profiles`, `memberships` | Supabase未設定時はデモログイン（`MOCK_USERS`） | 基盤 |
| LAYOUT-01 | 共通レイアウト | 左メニュー表示制御 | CONNECTED | `feature_flags` | Supabase未設定時はデフォルト表示 | Phase0 |
| STORE-01 | 共通 | 右上店舗セレクタ | HYBRID | `stores`（`storesService.listAccessible`） | Supabase未設定時は「Supabase未設定」バッジ表示 | P1-08拡張 |
| STORE-02 | 共通 | 店舗0件警告表示 | CONNECTED | `stores` | SQL前提でなくGUI復旧前提に変更済み | P1-08拡張 |
| DASH-01 | ダッシュボード | KPIカード/グラフ | MOCK_ONLY | なし（固定データ） | 実データ未接続 | 未着手（将来P3系） |
| POST-01 | 新規投稿 | 投稿保存（単一店舗） | HYBRID | `posts` | Supabase未設定時は疑似成功通知 | P1-06対応済み |
| POST-02 | 新規投稿 | 画像アップロード | CONNECTED | Supabase Storage `post-media`, `post_media` | バケット/ポリシー未設定だと失敗 | P1 |
| POST-03 | 新規投稿 | 投稿先選択 | MOCK_ONLY | なし | `MOCK_ACCOUNTS` 固定 | P2で実接続予定 |
| POST-04 | 新規投稿 | 店舗グループ一括投稿 | CONNECTED | `store_groups`, `postsService.createBulk` | ADMIN/SUPERVISOR/MANAGERのみ利用可。失敗時ロールバック | P1-09 |
| POST-07 | 新規投稿 | テンプレート適用/ブランド警告 | HYBRID | `brandKitService`, `brand_kits`, `post_templates` | migration `202602060014` 未適用環境は専用エラー。Supabase未設定時はテンプレ未登録表示 | P2-05 |
| POST-05 | 投稿一覧 | Instagram投稿実行（手動） | CONDITIONAL | `postPublishService`, Edge Function `instagram-publish-post`, `post_publish_logs` | `202602060011` + Function配備後に有効。条件未達時はMOCK記録で実行 | P2-02 |
| POST-06 | 投稿一覧 | Facebook投稿実行（手動） | CONDITIONAL | `postPublishService`, Edge Function `facebook-publish-post`, `post_publish_logs` | Function配備後に有効。条件未達時はMOCK記録で実行 | P2-03 |
| POSTLIST-01 | 投稿一覧 | 一覧表示/編集/削除 | HYBRID | `posts`, `post_media` | Supabase未設定時は `MOCK_POSTS` | P1 |
| POSTLIST-02 | 投稿一覧 | 承認申請/承認/差し戻し | HYBRID | `posts`（承認列）, `post_approval_comments` | migration未適用時は専用エラー表示 | P1-06/07 |
| CAL-01 | カレンダー | 日付セル投稿表示 | HYBRID | `posts` | Supabase未設定時は `MOCK_POSTS` | P1 |
| CAL-02 | カレンダー | カレンダーから投稿作成 | HYBRID | `posts`, `post_media` | 投稿先は `MOCK_ACCOUNTS` | P1（P2拡張余地） |
| INBOX-01 | 受信箱 | 受信一覧/返信送信 | HYBRID | `inbox_messages` | Supabase未設定時は `MOCK_MESSAGES` | P1 |
| INBOX-02 | 受信箱 | AI返信案作成/承認送信 | HYBRID | Gemini API, `inbox_messages.reply_draft_*` | Geminiキー未設定時は生成不可 | P1-05 |
| INBOX-03 | 受信箱 | Facebook返信実行（手動） | CONDITIONAL | `messageReplyService`, Edge Function `facebook-reply-message`, `inbox_reply_logs` | `202602060012` + Function配備後に有効。条件未達時はMOCK返信で記録 | P2-03 |
| INBOX-04 | 受信箱 | タグ/担当/対応期限管理 | CONNECTED | `inbox_messages.tags`, `assigned_user_id`, `due_at`, `sla_status`, `inboxService.updateWorkflow` | `202602060013` 未適用環境では保存不可（専用エラー） | P2-04 |
| RANK-01 | 順位計測 | キーワードCRUD | CONDITIONAL | `rankKeywordService`, `rank_keywords` | `202602060015` 未適用環境では保存不可（専用エラー）。`rank_tracker` が `HIDDEN/ADMIN_ONLY` の場合は非表示 | P3-01 |
| RANK-02 | 順位計測 | 日次順位収集（手動実行/履歴/結果） | CONDITIONAL | `rankCollectionService`, Edge Function `rank-collect`, `rank_collection_runs`, `rank_collection_results` | `202602060016` 未適用環境では実行不可。現時点はMOCK収集のみ、REAL指定は明示FAILED | P3-02 |
| RANK-03 | 順位計測 | 競合ターゲット管理/競合比較収集 | CONDITIONAL | `competitorService`, `competitor_targets`, `competitor_metric_snapshots`, Edge Function `rank-collect` | `202602060017` 未適用環境では実行不可。現時点はMOCK収集のみ、REAL指定は明示FAILED | P3-03 |
| RANK-04 | 順位計測 | 順位/競合ダッシュボード（推移可視化） | CONDITIONAL | `rankCollectionService.listRunDetailsByStore`, `rank_collection_runs`, `rank_collection_results`, `competitor_metric_snapshots` | run0件は空状態表示。競合データ未作成でも順位可視化は継続 | P3-04 |
| RANK-05 | 順位計測 | NAP整合性チェック（run履歴/不一致表示） | CONDITIONAL | `napConsistencyService`, `nap_consistency_runs`, `nap_consistency_results`, `provider_configurations` | `202602060018` 未適用環境では実行不可。provider未設定は `MISSING` として記録 | P3-05 |
| RANK-06 | 順位計測 | NAPアラート（一覧/ACK/解消） | CONDITIONAL | `napAlertService`, `nap_alerts` | `202602060019` 未適用環境では表示不可（P3-05は継続）。NAPチェック実行でアラート同期 | P3-06 |
| SURVEY-01 | アンケート管理 | 作成/下書き保存/公開/アーカイブ | CONNECTED | `surveys` | 店舗未選択時は操作不可 | P1-01 |
| SURVEY-02 | アンケート管理 | 分岐しきい値 | CONNECTED | `surveys.positive_threshold`, `survey_responses.branch_type` | migration未適用時は失敗 | P1-02 |
| SURVEY-03 | アンケート管理 | 指標カード/CSV出力 | CONNECTED | `survey_events`, `survey_responses` | - | P1-03 |
| SURVEY-04 | アンケート管理 | QR/POP生成 | CONNECTED | `surveyAssetService`（クライアント生成） | ブラウザ印刷許可が必要 | P1-04 |
| SURVEY-05 | アンケート管理 | 設問文言/サンクス文言/ヘッダー画像設定 | CONDITIONAL | `surveys.(question_text, thanks_*, header_image_*)`, Supabase Storage `survey-media` | `202602100001` 未適用環境では保存不可。画像は JPEG/PNG/WEBP（3MB以下） | P1-10 |
| SURVEY-PUB-01 | 公開アンケート | 公開URL回答 | CONNECTED | `surveys`, `survey_responses`, `survey_events` | - | P1-01〜03 |
| SET-01 | 設定>プロフィール | 名前/メール/パスワード更新 | CONNECTED | Supabase Auth, `profiles` | - | 基盤 |
| SET-02 | 設定>店舗情報(MEO) | 店舗作成（0件復旧）/更新 | CONNECTED | RPC `create_store_for_actor`, `stores` | 上限超過時は明示エラー | P1-08拡張 |
| SET-03 | 設定>SNS連携 | Provider追加/能力設定/表示状態 | CONDITIONAL | `provider_catalog`, `provider_capabilities` | DB適用＋権限設定が必要 | Phase0 |
| SET-04 | 設定>SNS連携 | Provider設定JSON保存 | CONDITIONAL | `provider_configurations` | - | Phase0 |
| SET-05 | 設定>SNS連携 | Secret保存/接続テスト | CONDITIONAL | Edge Functions `admin-provider-secret-upsert`, `admin-provider-connection-test` | 実API read-only（GBP/FB/IG）で判定。Functions配備/Secrets登録/有効ログインセッションが必須。Gateway 401対策としてフロントはHTTP直叩き（`apikey`+`Authorization`）を使用 | Phase0/P2 |
| SET-07 | 設定>SNS連携 | OAuth連携（開始/コールバック完了/解除） | CONDITIONAL | Edge Functions `oauth-start`, `oauth-callback` + RPC `oauth_disconnect_session` + `oauth_sessions` | `202602060010` 適用後に有効。認可コード貼り付けは廃止し、コールバックで自動完了 | P2-01 |
| SET-06 | 設定>システム管理 | APIキー表示UI | UI_ONLY | なし | ダミー表示（`****************************`） | 未着手 |
| SET-08 | 設定>システム管理 | ブランドキット/投稿テンプレ管理 | CONDITIONAL | `brand_kits`, `post_templates`, `brandKitService` | `202602060014` 適用後に有効。権限は内部（ADMIN/SUPERVISOR） | P2-05 |
| SET-09 | 設定>システム管理 | サイドバーメニュー順序（D&D） | CONNECTED | `navigationOrderService`（localStorage） | ADMINのみ操作可。既定順は `ダッシュボード→新規投稿→投稿一覧→カレンダー→受信箱→アンケート→順位チェック→ユーザー管理→契約プラン` | UI改善 |
| USER-01 | ユーザー管理 | ユーザー一覧/削除 | HYBRID | `memberships`, `profiles` | Supabase未設定時は `MOCK_USERS` | P1 |
| USER-02 | ユーザー管理 | 新規ユーザー招待 | CONDITIONAL | Edge Function `admin-create-user` | Function配備＋`SUPABASE_SERVICE_ROLE_KEY`必須 | P1 |
| USER-03 | ユーザー管理 | 店舗グループCRUD | CONNECTED | `store_groups`, `store_group_stores` | USERは編集不可 | P1-08 |
| USER-04 | ユーザー管理 | USER別 店舗上限設定 | CONNECTED | `org_store_policies`, `user_store_controls` | ADMIN/SUPERVISORのみ操作可 | P1-08拡張 |
| USER-05 | ユーザー管理 | CSV一括店舗作成ON/OFF | CONNECTED | `user_store_controls.allow_csv_store_bulk_create` | USER対象のみ | P1-08拡張 |
| USER-06 | ユーザー管理 | CSV一括店舗作成実行 | CONNECTED | RPC `bulk_create_stores_for_user` | 1件不正で全体失敗（0件作成） | P1-08拡張 |
| USER-07 | ユーザー管理 | モーダル表示（スモーク） | CONNECTED | `ModalPortal` | `fixed inset-0` でずれ対策済み | P1-08拡張 |
| USER-08 | ユーザー管理 | 店舗グループ一括設定（機能公開） | CONNECTED | `feature_flags`（`featureFlagsService.upsertForStoreGroup`） | 実行は内部（ADMIN/SUPERVISOR）のみ。顧客MANAGERは参照のみ | P1-09 |
| BILL-01 | 課金/請求 | 契約プラン作成/更新 + ORG割当（請求は外部運用） | CONDITIONAL | `billing_plans`, `org_subscriptions`, `audit_logs`, Edge Functions `admin-billing-plan-upsert`, `admin-org-subscription-set-plan` | 画面表示は全ロール可。編集は内部（ADMIN/SUPERVISOR）のみ。Stripe本番課金API連携・請求書は未実装（外部運用） | Phase4 |
| PWA-01 | アプリ化 | PWAインストール/オフライン対応 | CONDITIONAL | `pwa_installations` | `manifest`/`service worker`/インストール導線は実装済み。PWA利用ログ保存（`pwa_installations`）は未接続 | Phase4 |

## 3. Edge Functions 配備台帳
| Function名 | リポジトリソース | 必須Secrets | 現在状態 |
|---|---|---|---|
| `admin-create-user` | `supabase/functions/admin-create-user/index.ts` | `SUPABASE_SERVICE_ROLE_KEY` | 配備済み（2026-02-06）/ `Verify JWT=OFF` 設定運用 |
| `admin-billing-plan-upsert` | `supabase/functions/admin-billing-plan-upsert/index.ts` | `SUPABASE_SERVICE_ROLE_KEY` | 配備済み（2026-02-09 UTC, CLI実施）/ `Verify JWT=OFF` |
| `admin-org-subscription-set-plan` | `supabase/functions/admin-org-subscription-set-plan/index.ts` | `SUPABASE_SERVICE_ROLE_KEY` | 配備済み（2026-02-09 UTC, CLI実施）/ `Verify JWT=OFF` |
| `admin-provider-secret-upsert` | `supabase/functions/admin-provider-secret-upsert/index.ts` | `SUPABASE_SERVICE_ROLE_KEY`, `PROVIDER_CONFIG_ENCRYPTION_KEY` | 配備済み（2026-02-06）/ Secrets登録済み（2026-02-06）/ `Verify JWT=OFF` 設定運用 |
| `admin-provider-connection-test` | `supabase/functions/admin-provider-connection-test/index.ts` | `SUPABASE_SERVICE_ROLE_KEY`, `PROVIDER_CONFIG_ENCRYPTION_KEY` | 配備済み（2026-02-10 CLI再配備）/ 実API read-only接続テスト対応 / `Verify JWT=OFF` |
| `oauth-start` | `supabase/functions/oauth-start/index.ts` | `SUPABASE_SERVICE_ROLE_KEY`（任意: `OAUTH_DEFAULT_RETURNTO`, `OAUTH_RETURNTO_ALLOWLIST`） | 配備済み（2026-02-10 CLI配備）/ `Verify JWT=OFF` |
| `oauth-callback` | `supabase/functions/oauth-callback/index.ts` | `SUPABASE_SERVICE_ROLE_KEY`, `PROVIDER_CONFIG_ENCRYPTION_KEY`（任意: `OAUTH_DEFAULT_RETURNTO`, `OAUTH_RETURNTO_ALLOWLIST`） | 配備済み（2026-02-10 CLI配備）/ `Verify JWT=OFF` |
| `instagram-publish-post` | `supabase/functions/instagram-publish-post/index.ts` | `SUPABASE_SERVICE_ROLE_KEY` | 配備済み（2026-02-08 ユーザー確認）/ `Verify JWT=OFF` |
| `facebook-publish-post` | `supabase/functions/facebook-publish-post/index.ts` | `SUPABASE_SERVICE_ROLE_KEY` | 配備済み（2026-02-08 ユーザー確認）/ `Verify JWT=OFF` |
| `facebook-reply-message` | `supabase/functions/facebook-reply-message/index.ts` | `SUPABASE_SERVICE_ROLE_KEY` | 配備済み（2026-02-08 ユーザー確認）/ `Verify JWT=OFF` |
| `rank-collect` | `supabase/functions/rank-collect/index.ts` | `SUPABASE_SERVICE_ROLE_KEY` | 配備済み（2026-02-09 CLI実行確認）/ `Verify JWT=OFF`。P3-02/P3-03の収集処理を担当 |

## 4. DB migration適用台帳（P1/P2/P3/P4）
| migrationファイル | 目的 | 状態 |
|---|---|---|
| `supabase/migrations/202602060002_p1_surveys.sql` | P1-01 アンケート基盤 | 適用済み想定（要環境確認） |
| `supabase/migrations/202602060003_p1_survey_branching.sql` | P1-02 分岐導線 | ユーザー実行で成功報告あり |
| `supabase/migrations/202602060004_p1_survey_metrics.sql` | P1-03 指標/CSV | 適用済み想定（要環境確認） |
| `supabase/migrations/202602060005_p1_review_ai_reply_drafts.sql` | P1-05 AI返信案 | ユーザー実行で成功報告あり |
| `supabase/migrations/202602060006_p1_post_approval_workflow.sql` | P1-06 承認WF | ユーザー実行で成功報告あり |
| `supabase/migrations/202602060007_p1_post_rejection_comment_history.sql` | P1-07 差戻し履歴 | ユーザー実行で成功報告あり |
| `supabase/migrations/202602060008_p1_store_group_management.sql` | P1-08 店舗グループ | ユーザー実行で成功報告あり |
| `supabase/migrations/202602060009_p1_store_lifecycle_and_csv_import.sql` | P1-08拡張 店舗ライフサイクル/CSV | ユーザー実行で成功報告あり |
| `supabase/migrations/202602060010_p2_oauth_common_foundation.sql` | P2-01 OAuth共通基盤 | 実装済み。未適用環境ではOAuth導線が動作しない |
| `supabase/migrations/202602060011_p2_instagram_publish.sql` | P2-02 Instagram投稿履歴 | 実装済み。未適用環境では投稿成否履歴が記録されない |
| `supabase/migrations/202602060012_p2_facebook_publish_reply.sql` | P2-03 Facebook返信履歴 | 実装済み。未適用環境では返信履歴が記録されない |
| `supabase/migrations/202602060013_p2_inbox_advanced_workflow.sql` | P2-04 受信箱タグ/担当/対応期限 | 実装済み。未適用環境ではワークフロー保存が実行できない |
| `supabase/migrations/202602060014_p2_template_brand_kit.sql` | P2-05 テンプレ/ブランドキット | 実装済み。未適用環境ではテンプレ/ブランド設定を保存できない |
| `supabase/migrations/202602060015_p3_rank_keyword_management.sql` | P3-01 順位キーワード管理 | 実装済み。未適用環境ではキーワードCRUDが実行できない |
| `supabase/migrations/202602060016_p3_rank_daily_collection.sql` | P3-02 日次順位収集ジョブ | 実装済み。未適用環境では収集実行/履歴参照が実行できない |
| `supabase/migrations/202602060017_p3_competitor_comparison_collection.sql` | P3-03 競合比較収集 | 実装済み。未適用環境では競合ターゲット管理/競合収集が実行できない |
| `supabase/migrations/202602060018_p3_nap_consistency_check.sql` | P3-05 NAP整合性チェック | 実装済み。未適用環境ではNAPチェック履歴/結果が実行できない |
| `supabase/migrations/202602060019_p3_nap_alert_operations.sql` | P3-06 NAPアラート運用 | 実装済み。未適用環境ではNAPアラート表示/運用が実行できない |
| `supabase/migrations/202602060020_p4_billing_pwa_foundation.sql` | P4 課金/PWA DB基盤 | 実装済み。未適用環境ではPhase4 DB監査が `PGRST205` で失敗する |
| `supabase/migrations/202602090001_p4_roles_supervisor_and_plan_admin_gui.sql` | P4 ロール再編（SUPERVISOR）+ 契約プランGUI | 実装済み（要適用）。未適用環境ではロール再編/プラン管理GUIが正しく動作しない |
| `supabase/migrations/202602090002_p4_real_oauth_callback_and_credentials_encryption.sql` | P4 実OAuthコールバック運用補助index | 2026-02-10 CLI適用済み（本番）。`oauth_sessions` / `integration_credentials` の参照最適化 |
| `supabase/migrations/202602100001_p1_survey_customization_and_header_media.sql` | P1-10 アンケート文言カスタム + ヘッダー画像 | 実装済み（要適用）。未適用環境ではSURVEY-05を保存できない |

## 5. 現時点のモック/未接続残件（優先順）
1. ダッシュボードKPIが固定値（実データ未接続）
2. 投稿先アカウント選択が `MOCK_ACCOUNTS` 固定
3. 設定 > システム管理タブのAPIキー欄はUIのみ
4. 画面内の検索入力（ヘッダー検索など）はUIのみで未接続

## 6. 更新手順（実装アクションとセット）
1. 実装/修正に着手する前に、対象行の「現在値」を確認する
2. 実装/修正後に、該当行の `ステータス/接続先/モック/フェーズ` を更新する
3. 新しい画面やボタンを作った場合は、新規行を追加する
4. Supabase GUI作業（Function配備、Secret追加、migration実行）があったら `3` と `4` を更新する
5. 最終確認手順は `docs/12_P1_FINAL_VERIFICATION_RUNBOOK.md` と整合させる

## 7. 監査スナップショット（自動監査結果）
| Phase | 最新結果 | 監査時刻（UTC） | 監査コミット | サマリJSON |
|---|---|---|---|---|
| Phase1 | PASS | 2026-02-09T05:27:36Z | `23047d8` | `output/audit/phase1/20260209_142736/phaseAudit.summary.json` |
| Phase2 | PASS | 2026-02-09T02:44:32Z | `8ac24c7` | `output/audit/phase2/20260209_114432/phaseAudit.summary.json` |
| Phase3 | PASS | 2026-02-09T02:50:44Z | `b71680e` | `output/audit/phase3/20260209_115044/phaseAudit.summary.json` |
| Phase4 | PASS | 2026-02-09T05:24:12Z | `20dddfc` | `output/audit/phase4/20260209_142412/phaseAudit.summary.json` |

### 備考
- Phase3は `rank-collect` 未配備によるFAILを経て、関数配備後にPASSへ収束。
- Phase4は DB基盤migration（`202602060020`）適用済み。課金/請求UI導線とPWA導線の追加後、A/B/C すべてPASSへ収束。
- 監査詳細の時系列ログは `docs/14_PHASE_AUDIT_LOG.md` を正本とし、本節は最新状態の要約のみ保持する。
