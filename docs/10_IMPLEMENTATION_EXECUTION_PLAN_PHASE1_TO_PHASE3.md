# TEPPEN MEO：Phase1〜Phase3 実装実行計画（再監査版）

最終更新: 2026-02-08（P3-01追記）

この計画書は、Phase1〜Phase3の機能を「作り直しなし」で進めるための実装設計書です。  
方針は「Phase0基盤 → Phase1 → Phase2 → Phase3 → Step2集中テスト → 修正 → デプロイ」で固定します。

## 1. 目的・範囲・非範囲（Phase1-3完了、Phase4除外）
### 目的
- 機能追加時にスパゲティ化しない構造を先に確立する
- 未完成機能を安全に隠しながら並行開発できる運用を確立する
- 外部API連携をprovider単位で拡張可能にする
- テスト・修正・デプロイで詰まらない意思決定を先に固定する

### 範囲（本計画で実施）
- `IMPROVEMENTS.md` の Phase1 / Phase2 / Phase3
- それを支える Phase0 基盤（新設）
- ADMINによるGUI設定（Secrets、公開状態、provider追加）

### 非範囲（本計画では実施しない）
- Phase4（Stripe、PWA）
- 課金・請求運用
- モバイルアプリ化

## 2. Phase0基盤（拡張性・安全性の前提）
Phase1〜3に着手する前に、以下を完了条件とします。

| Ticket | 目的 | 成果物 | 依存 | DoD |
|---|---|---|---|---|
| F0-01 | Provider/機能公開の土台を統一 | `provider_catalog` / `provider_capabilities` / `feature_flags` | - | UI/DB/APIで同一判定が使える |
| F0-02 | Secretsの安全運用 | `provider_configurations` + 管理UI + 接続テストAPI | F0-01 | 平文再表示不可、ADMIN限定 |
| F0-03 | Adapter登録の共通化 | `ProviderAdapter` 契約 + registry | F0-01 | provider追加時に実装差分が局所化される |
| F0-04 | 監査ログ共通化 | `audit_logs` 記録ユーティリティ | F0-01 | 変更系操作の記録が漏れない |
| F0-05 | migration運用整備 | `supabase/migrations` 運用ルール | - | forward-onlyで適用履歴が追跡可能 |
| F0-06 | 実装中ガードレール | `typecheck/build/契約スモーク` の必須化 | F0-01〜05 | Step2前でも破綻を早期検知できる |

### 2.1 重要インターフェース/型（固定仕様）
```ts
type ProviderKind = 'NATIVE' | 'GENERIC';
type AuthKind = 'OAUTH2' | 'API_KEY' | 'WEBHOOK' | 'NONE';
type VisibilityState = 'HIDDEN' | 'ADMIN_ONLY' | 'ENABLED';
type TestMode = 'REAL' | 'MOCK';
type RuntimeMode = 'ACTIVE' | 'DEGRADED' | 'BLOCKED';

interface ProviderCatalog {
  provider_key: string; // unique
  display_name: string;
  provider_kind: ProviderKind;
  auth_kind: AuthKind;
  default_visibility: VisibilityState;
}

interface ProviderCapability {
  provider_key: string;
  can_connect: boolean;
  can_sync_inbox: boolean;
  can_publish: boolean;
  can_reply: boolean;
  can_fetch_metrics: boolean;
}

interface ProviderReadiness {
  provider_key: string;
  has_gui_config: boolean;
  has_adapter: boolean;
  connection_status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  test_mode: TestMode;
  runtime_mode: RuntimeMode;
}
```

### 2.2 ProviderAdapter契約（NATIVEのみ必須）
```ts
interface ProviderAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  syncInbox(): Promise<void>;
  publishPost(): Promise<void>;
  replyMessage(): Promise<void>;
  healthCheck(): Promise<void>;
}
```

## 3. provider拡張モデル（ハイブリッド）
### 3.1 追加方式
- GUIで `provider_catalog` をいつでも追加可能
- ただし高度連携（OAuth、投稿、返信、同期）はadapter有無で段階解放
- `GENERIC` はGUI中心、`NATIVE` はadapter追加を標準運用

### 3.2 provider追加時の初期状態
- 追加直後は必ず `ADMIN_ONLY`
- 初期許可機能は接続確認/受信系のみ
- 投稿/返信/指標はadapter実装後にON

### 3.3 provider追加の義務チェック（自動生成）
provider追加時に次のチェックリストを自動生成し、PRに添付することを必須化します。
- 設定: GUI入力項目、必須/任意、検証方法
- 権限: ADMIN以外の閲覧/編集拒否確認
- 監査: 作成/更新/無効化ログ確認
- テスト: REAL/MOCK判定とE2Eケース
- 公開: `ADMIN_ONLY` での検証完了確認

### 3.4 provider追加の標準運用
- `GENERIC`: GUI追加のみで運用開始（許可機能内）
- `NATIVE`: provider追加用skillでadapter雛形を作成し、契約テストを通してから公開

## 4. Secrets管理モデル（ADMIN GUI入力、再表示不可）
### 4.1 保存方式
- 第一候補: Supabase Vault
- 代替: `pgcrypto + Edge Function管理鍵`
- どちらでも「保存後の平文再表示は禁止」

### 4.2 GUI運用ルール
- ADMINのみ入力/更新/削除可能
- 非ADMINは項目名のみ閲覧可（値は不可）
- 更新時は再入力必須（マスク復元禁止）

### 4.3 鍵ローテーション
- 四半期ごと定期ローテーション
- インシデント時は即時ローテーション
- ローテーション手順は `docs/05_RUNBOOK_KNOMURA.md` に追記して運用

## 5. 機能公開制御（`HIDDEN/ADMIN_ONLY/ENABLED`）
### 5.1 状態定義
- `HIDDEN`: 全ユーザー非表示
- `ADMIN_ONLY`: ADMINのみ表示/操作可能
- `ENABLED`: 権限を満たす全ユーザーへ公開

### 5.2 運用ルール
- 新規機能は初期値 `ADMIN_ONLY`
- Step2テスト合格 + 受入完了後に `ENABLED`
- 障害時は `HIDDEN` もしくは `ADMIN_ONLY` へ即時切戻し

## 6. フェーズ別バックログ（1機能=1チケット、依存順）
### Phase1
| Ticket | 機能 | 主な依存 | 完了条件（要約） |
|---|---|---|---|
| P1-01 | アンケート作成/公開 | F0-01 | 公開URLで回答可能 |
| P1-02 | 分岐導線 | P1-01 | 高評価導線/不満回収導線が機能 |
| P1-03 | 指標/CSV | P1-01 | 閲覧数/回答率/分岐率を出力 |
| P1-04 | 口コミ依頼QR/POP | P1-01 | QR/PDF生成が可能 |
| P1-05 | 口コミAI返信案 | F0-02 | AI返信案作成と承認前保留 |
| P1-06 | 承認ワークフロー | F0-01 | 作成→承認→公開が成立 |
| P1-07 | 差戻しコメント | P1-06 | 履歴付きで差戻し可能 |
| P1-08 | 店舗グループ管理 | F0-01 | CRUDと権限が成立 |
| P1-09 | 一括投稿/一括設定 | P1-08 | グループ単位操作が可能 |

### Phase2
| Ticket | 機能 | 主な依存 | 完了条件（要約） |
|---|---|---|---|
| P2-01 | OAuth共通基盤（IG/FB） | F0-02/F0-03 | 接続/解除/再認証が可能 |
| P2-02 | Instagram投稿連携 | P2-01 | 投稿成否が履歴化される |
| P2-03 | Facebook投稿/返信連携 | P2-01 | 投稿/返信の実行履歴が残る |
| P2-04 | 受信箱高度化 | P2-03 | タグ/担当/SLAを管理 |
| P2-05 | テンプレ/ブランドキット | F0-01 | 定型文・NGワード・タグ運用 |

### Phase3
| Ticket | 機能 | 主な依存 | 完了条件（要約） |
|---|---|---|---|
| P3-01 | 順位キーワード管理 | F0-01 | キーワードCRUDが成立 |
| P3-02 | 日次順位収集ジョブ | P3-01 | 日次収集と再実行が可能 |
| P3-03 | 競合比較収集 | P3-02 | 競合指標を時系列保存 |
| P3-04 | 順位/競合ダッシュボード | P3-03 | 推移と比較を可視化 |
| P3-05 | NAP整合性チェック | F0-01 | 表記揺れ検知が機能 |
| P3-06 | NAPアラート運用 | P3-05 | 検知→通知→解消管理が成立 |

## 7. 実装中ガードレール（Step2前の最小品質）
- すべての実装チケットで `npm run typecheck` と `npm run build` を必須
- 契約スモーク（adapter解決・権限・feature flag判定）を必須
- 1PRあたりの変更を機能単位に限定（横断的大改修の一括投入禁止）
- 新規provider対応は必ず `provider_catalog` 経由で実装（ハードコード禁止）
- 例外は「緊急障害対応」のみ。事後に設計へ回収する

## 8. データ移行/互換/ロールバック戦略
### 8.1 migration運用
- `supabase/migrations` 配下に時系列ファイルを追加（forward-only）
- 既存 `schema.sql` / `rls.sql` は初期セットアップ用途として維持
- 本番適用は「未適用migrationを順次実行」で統一

### 8.2 互換方針
- 破壊的変更は2段階移行（追加→移行→切替→削除）
- 旧列/旧APIは廃止予定日を明記して段階廃止

### 8.3 ロールバック方針
- 原則は `feature flag即時遮断 + forward fix`
- DBを過去状態へ戻す運用は緊急時以外禁止
- 緊急時は復旧runbookに従い、影響範囲を限定して対応

## 9. デプロイ戦略（stg→prod、段階公開）
1. `staging` へ migration適用
2. `ADMIN_ONLY` で動作検証（REAL/MOCK判定含む）
3. 受入証跡（ログ/スクショ/結果）を保存
4. `production` へ反映
5. 監査ログ・エラー率・同期成功率を監視
6. 問題なしを確認して `ENABLED` へ切替

## 10. リスク、停止条件、復旧手順
### 主要リスク
- provider追加時の判定ロジック分岐増大
- Secrets運用ミス（誤設定/誤公開）
- 外部API障害時の運用停止
- migration順序ミスによる障害

### 停止条件（実装を止める条件）
- `typecheck/build` が連続で不通
- 権限漏れ（非ADMINがSecrets操作可能）が発見
- 本番で `DEGRADED` が閾値を超過
- migration適用が再現不能

### 復旧手順
1. 該当機能を `ADMIN_ONLY` または `HIDDEN` へ切替
2. 影響範囲を監査ログで特定
3. forward fix を最優先で投入
4. 再検証後に段階再公開

## 11. 店舗ライフサイクル是正（P1-08拡張）
### 11.1 ライフサイクル定義
- 作成: USERは設定画面から初回店舗をGUI作成できる
- 所属: USERは自分が所属する店舗のみ操作可能
- 利用: store selector は所属店舗のみ表示
- 上限管理: USER既定上限は1、ADMIN/MANAGERがユーザー単位で上書き
- CSV一括: USER単位でON/OFFし、ON時のみ一括作成可能
- 停止: 上限超過やCSV不正時は作成停止（部分成功なし）

### 11.2 データモデル（追加）
- `org_store_policies`
  - `default_user_store_limit`（既定1）
  - `allow_user_store_creation`
- `user_store_controls`
  - `max_stores`（ユーザー個別上限）
  - `allow_csv_store_bulk_create`（ユーザー単位ON/OFF）

### 11.3 実装ルール（固定）
- USERロールの `store_id = null` は storeアクセス権として扱わない
- USERの店舗作成は `effective_limit` と `current_count` を毎回検証
- CSV一括作成は以下すべてを満たす場合のみ実行:
  - 対象USERで `allow_csv_store_bulk_create = true`
  - テンプレヘッダ完全一致
  - 必須列入力済み
  - `website` はURL形式
  - 同一CSV重複なし
  - `current_count + valid_rows <= effective_limit`

### 11.4 CSVエラー仕様（全体失敗）
- エラー形式: `line`, `column`, `code`, `message`
- 1件でもエラーがあれば 0件作成（all-or-nothing）
- UIは先頭20件を表示し、運用上は全件ログ保存を推奨

### 11.5 店舗0件からの復旧（SQL不要）
- USERでログイン後、`設定 -> 店舗情報(MEO)` を開く
- 「店舗を作成」フォームに入力し保存
- 作成成功後、store selectorへ自動反映
- 失敗時は上限超過/権限/入力不正を通知表示し、SQL Editor実行は不要

## 12. P1-09 一括投稿 / 一括設定（実装確定）
### 12.1 一括投稿（店舗グループ単位）
- 実装画面: `新規投稿`
- 対象選択:
  - `選択中の店舗`（従来）
  - `店舗グループ`（ADMIN/MANAGERのみ）
- 実装ルール:
  - 1投稿フォームの内容を、グループ内全店舗へ同時作成
  - USERは一括投稿を実行不可（単一店舗のみ）
  - 一括作成中にエラーが出た場合、作成済み投稿をロールバック
  - 画像は作成済み各投稿へ順次アップロード（失敗件数を通知）

### 12.2 一括設定（機能公開フラグ）
- 実装画面: `ユーザー・契約管理 -> 店舗グループ管理`
- 対象: 選択グループ内の全店舗
- 設定項目:
  - `dashboard / calendar / survey / create_post / post_list / inbox`
  - 状態: `HIDDEN / ADMIN_ONLY / ENABLED`
- 実装ルール:
  - store単位 `feature_flags` へ一括upsert
  - 実行権限はADMINのみ（MANAGERは参照のみ）
  - 反映件数を通知し、対象0件時は実行拒否

### 12.3 完了条件
- グループ選択で一括投稿が作成される（投稿数 = 対象店舗数）
- 一括設定で選択機能の公開状態が対象店舗へ反映される
- `typecheck/build/smoke` が通る
- 状態台帳(`docs/13`)と検証手順書(`docs/12`)が同時更新される

## 13. P2-01 OAuth共通基盤（IG/FB/GBP）実装方針
### 13.1 目的
- provider個別実装の前に、OAuth連携の開始/完了/解除を共通RPCで統一する
- 連携状態の遷移を `DISCONNECTED -> CONNECTED -> DISCONNECTED` で再現可能にする
- 接続状態と監査ログを同時に更新し、障害時の切り分けを容易にする

### 13.2 DB変更（migration）
- 対象: `supabase/migrations/202602060010_p2_oauth_common_foundation.sql`
- 追加:
  - `oauth_sessions`（state_token/期限/状態管理）
  - RPC `oauth_start_session`
  - RPC `oauth_complete_session`
  - RPC `oauth_disconnect_session`
- セキュリティ:
  - `oauth_sessions` はRLS deny-all（クライアント直接参照不可）
  - RPCは `authenticated` のみ実行許可
  - 実行時に `actor_can_manage_store_integration`（ADMIN/MANAGER）を必須化

### 13.3 UI/Service変更
- 対象画面: `設定 -> SNS連携設定`
- `auth_kind = OAUTH2` の provider では「連携する」押下時に OAuth開始モーダルを表示
- 認可URLを新規タブで開き、取得した認可コードで「接続を完了」
- 連携解除は共通RPCを呼び、`integration_credentials` も同時に破棄

### 13.4 実装ルール（固定）
- OAuth対象providerは `provider_catalog.auth_kind = OAUTH2` かつ `is_active = true` の場合のみ許可
- 期限切れstateは `EXPIRED` として確定し、再利用禁止
- 本フェーズは共通基盤のみ（外部OAuth実通信はP2-02/P2-03で実装）

### 13.5 完了条件（P2-01）
- OAUTH2 providerで `連携する -> OAuth開始 -> 認可コード入力 -> 接続完了` が動作する
- `連携解除` で `integrations.status = DISCONNECTED` へ戻る
- `audit_logs` に `oauth_start/oauth_complete/oauth_disconnect` が残る
- 状態台帳(`docs/13`)と手順書(`docs/05`,`docs/12`)が同時更新される

## 14. P2-02 Instagram投稿連携（実装方針）
### 14.1 目的
- 投稿一覧からInstagram投稿を即時実行できるようにする
- 実行結果を `REAL/MOCK` とともに履歴化し、失敗時に再現可能な情報を残す

### 14.2 DB変更（migration）
- 対象: `supabase/migrations/202602060011_p2_instagram_publish.sql`
- 追加:
  - `post_publish_logs`（provider, mode, status, message, external_post_id）
- RLS:
  - `select`: storeアクセス可能ユーザー
  - `insert`: storeアクセス可能かつ `requested_by_user_id = auth.uid()`

### 14.3 実行モード判定
- `REAL` 条件:
  - `provider_catalog(INSTAGRAM).can_publish = true`
  - `provider_configurations.has_gui_config = true`
  - `provider_configurations.connection_status = CONNECTED`
  - `integrations.status = CONNECTED`
- 上記を満たさない場合は `MOCK`

### 14.4 アプリ側動作
- `投稿管理` に `Instagram投稿` ボタンを追加（ADMIN/MANAGERのみ）
- 実行対象:
  - `platforms` に `INSTAGRAM` を含む
  - `approval_status = APPROVED`
  - `status != PUBLISHED`
  - 予約時刻が未来でない
- 成功時:
  - `posts.status = PUBLISHED`, `published_at` を更新
  - `post_publish_logs` に成功記録
- 失敗時:
  - `posts.status = FAILED`
  - `post_publish_logs` に失敗記録

### 14.5 Edge Function
- 新規: `supabase/functions/instagram-publish-post/index.ts`
- 役割:
  - Auth/JWT検証
  - store/org権限（ADMIN/MANAGER）確認
  - `integration_credentials` からトークン読取
  - `post_media` の先頭画像を署名URL化
  - Instagram Graph APIへ `media -> media_publish` 実行

### 14.6 完了条件（P2-02）
- Instagram対象の承認済み投稿をボタン操作で投稿できる
- `REAL/MOCK` どちらでも `post_publish_logs` が残る
- 失敗時に `FAILED` へ遷移し、エラーメッセージがUIで確認できる
- 状態台帳(`docs/13`)と運用手順書(`docs/05`,`docs/12`)が同時更新される

## 15. P2-03 Facebook投稿/返信連携（実装方針）
### 15.1 目的
- 投稿一覧からFacebook投稿を即時実行できるようにする
- 統合受信箱からFacebook返信を実行できるようにする
- 投稿/返信ともに `REAL/MOCK` 実行結果を履歴化し、再現可能性を担保する

### 15.2 DB変更（migration）
- 対象: `supabase/migrations/202602060012_p2_facebook_publish_reply.sql`
- 追加:
  - `inbox_reply_logs`（provider, mode, status, message, external_reply_id）
- 補足:
  - Facebook投稿履歴は `post_publish_logs`（P2-02）を継続利用

### 15.3 実行モード判定（投稿/返信共通）
- `REAL` 条件:
  - `provider_catalog(FACEBOOK).is_active = true`
  - `provider_capabilities.can_publish`（投稿）または `can_reply`（返信）が `true`
  - `provider_configurations.has_gui_config = true`
  - `provider_configurations.connection_status = CONNECTED`
  - `integrations.status = CONNECTED`
- 条件未達の場合は `MOCK`（検証モード）で実行する

### 15.4 アプリ側動作
- 投稿管理:
  - `Facebook投稿` ボタンを追加（ADMIN/MANAGERのみ）
  - 実行条件: `platforms` に `FACEBOOK` を含む、`approval_status = APPROVED`、未来予約でない
  - 成功時: `posts.status = PUBLISHED` + `post_publish_logs` 成功記録
  - 失敗時: `posts.status = FAILED` + `post_publish_logs` 失敗記録
- 統合受信箱:
  - Facebookメッセージ返信時は `messageReplyService` を経由
  - 成功時: `inbox_messages.is_replied = true` + `inbox_reply_logs` 成功記録
  - 失敗時: `inbox_reply_logs` 失敗記録

### 15.5 Edge Functions
- 新規: `supabase/functions/facebook-publish-post/index.ts`
  - Facebook Graph API `/{page_id}/feed` を実行
- 新規: `supabase/functions/facebook-reply-message/index.ts`
  - Facebook Graph API `/{external_message_id}/comments` を実行
- 共通要件:
  - Auth/JWT検証
  - org権限（ADMIN/MANAGER）確認
  - `integration_credentials` からトークン読取
  - 実行結果を監査ログへ記録

### 15.6 完了条件（P2-03）
- Facebook対象の承認済み投稿をボタン操作で投稿できる
- Facebookメッセージ返信が受信箱から実行できる
- `REAL/MOCK` どちらでも投稿/返信の履歴が残る
- エラー時にUIトーストで原因確認できる
- 状態台帳(`docs/13`)と運用手順書(`docs/05`,`docs/12`)が同時更新される

## 16. P2-04 受信箱高度化（タグ/担当/SLA）実装方針
### 16.1 目的
- 受信箱メッセージを「返信するだけ」から「運用管理する」状態に引き上げる
- タグ、担当者、対応期限、SLAを同一画面で更新し、優先順位を可視化する
- 返信処理（P1-05/P2-03）との整合を保ち、返信完了時はSLAを `COMPLETED` へ確定する

### 16.2 DB変更（migration）
- 対象: `supabase/migrations/202602060013_p2_inbox_advanced_workflow.sql`
- 追加列（`inbox_messages`）:
  - `tags text[]`
  - `assigned_user_id uuid`
  - `due_at timestamptz`
  - `sla_status text`（`ON_TRACK/AT_RISK/OVERDUE/COMPLETED`）
- 追加index:
  - `assigned_user_id`, `due_at`, `sla_status`, `tags(GIN)`

### 16.3 Service/UI変更
- `services/inboxService.ts`
  - `listAssignableUsersByStore(storeId)` を追加
  - `updateWorkflow(messageId, tags, assignedUserId, dueAt)` を追加
  - 返信完了更新時に `sla_status = COMPLETED` を設定
- `components/UnifiedInbox.tsx`
  - フィルタ拡張（未返信/返信済み/担当あり/要注意/期限超過）
  - ワークフロー編集UI（タグ、担当、期限、SLAバッジ）を追加
  - 保存操作で `updateWorkflow` を呼び、一覧と詳細に即時反映

### 16.4 実装ルール（固定）
- 担当候補は `activeStoreId` の属する `org` のメンバーから取得する
- タグは最大10個、1タグ最大30文字（重複排除）
- SLA判定:
  - 返信済みは常に `COMPLETED`
  - 期限切れは `OVERDUE`
  - 24時間以内は `AT_RISK`
  - それ以外は `ON_TRACK`
- migration未適用時は明示エラーメッセージで停止し、暗黙フォールバックしない

### 16.5 完了条件（P2-04）
- 受信箱でタグ/担当/期限を保存できる
- 一覧と詳細にSLAが表示され、条件に応じて更新される
- 返信送信後に `sla_status = COMPLETED` が反映される
- 状態台帳(`docs/13`)と運用手順書(`docs/05`,`docs/12`)が同時更新される

## 17. P2-05 テンプレ/ブランドキット（定型文・NGワード・推奨タグ）実装方針
### 17.1 目的
- 投稿作成時にテンプレ適用を標準化し、本文作成時間を短縮する
- 組織ごとにNGワード/推奨ハッシュタグ/署名を集中管理し、投稿品質を平準化する
- ルールを「設定 > システム管理」で更新し、投稿画面に即時反映する

### 17.2 DB変更（migration）
- 対象: `supabase/migrations/202602060014_p2_template_brand_kit.sql`
- 追加テーブル:
  - `brand_kits`（`org_id` 単位ユニーク）
  - `post_templates`（`org_id + title` ユニーク, `is_active` で論理削除）
- 追加関数:
  - `actor_can_manage_brand_assets(target_org_id)`（ADMIN/MANAGERのみ更新可）
- RLS:
  - 同orgメンバーは参照可
  - 更新は `actor_can_manage_brand_assets` を通す

### 17.3 Service/UI変更
- `services/brandKitService.ts`
  - `getBrandKit` / `upsertBrandKit`
  - `listTemplates` / `createTemplate` / `removeTemplate`
  - `lintContent`（NGワード検知 + 推奨ハッシュタグ未使用検知）
- `components/SettingsView.tsx`
  - システム管理にブランドキット編集UIを追加
  - テンプレート作成/削除UIを追加
- `components/PostCreator.tsx`
  - テンプレート適用UIを追加
  - 推奨ハッシュタグのワンクリック挿入を追加
  - 本文下にNGワード/推奨タグ不足の警告を追加

### 17.4 実装ルール（固定）
- テンプレート作成時、`title`/`body` は必須
- `default_platforms` は `INSTAGRAM|FACEBOOK|GOOGLE_BUSINESS|TIKTOK` のみ許可
- テンプレート削除は `is_active=false` の論理削除で扱う
- NGワード/推奨タグはカンマまたは改行入力を許可し、保存前に重複除去する
- migration未適用時は「P2-05 migration適用後に再試行」の専用エラーを返す

### 17.5 完了条件（P2-05）
- 設定画面でブランドキットを保存できる
- 設定画面でテンプレートを作成/削除できる
- 投稿画面でテンプレ適用・推奨タグ追加・NGワード警告が機能する
- `docs/13` / `docs/05` / `docs/12` / `docs/11` が同時更新される

## 18. P3-01 順位キーワード管理（Rank Tracker基盤）実装方針
### 18.1 目的
- 店舗ごとの「順位計測に使うキーワード」をGUIで管理できるようにする
- 後続のP3-02（日次順位収集ジョブ）の入力データを整備する

### 18.2 DB変更（migration）
- 対象: `supabase/migrations/202602060015_p3_rank_keyword_management.sql`
- 追加テーブル:
  - `rank_keywords`
    - `store_id`, `keyword`, `note`, `is_active`
    - 重複防止: `unique(store_id, lower(keyword))`
- 更新日時:
  - `set_updated_at()` trigger で `updated_at` を自動更新
- RLS:
  - `user_has_store_access(store_id)` の範囲でCRUDを許可する

### 18.3 Service/UI変更
- `services/rankKeywordService.ts`
  - `listActiveByStore(storeId)` / `create` / `update` / `archive`（論理削除）
  - migration未適用時は専用エラー（P3-01 migration適用案内）を返す
- `components/RankTrackerView.tsx`
  - 一覧表示（店舗単位）
  - 追加/編集/削除（論理削除）
  - 店舗未選択時は操作不可の警告を表示
- `components/Layout.tsx` / `App.tsx`
  - メニューとビューを追加（feature flagで公開制御）

### 18.4 実装ルール（固定）
- キーワードは `trim` + 連続空白圧縮で正規化して保存する
- 1キーワードは最大80文字
- 削除は物理削除ではなく `is_active=false`（後続の収集履歴と整合を取りやすくするため）
- `rank_tracker` feature flag のデフォルトは `ADMIN_ONLY` とする

### 18.5 完了条件（P3-01）
- 順位計測画面でキーワードのCRUDが成立する
- `docs/13` / `docs/05` / `docs/12` / `docs/11` が同時更新される

---
## 明示的前提・デフォルト
- 実装順序は固定（Phase0先行）
- Step2集中テスト方針は維持。ただし実装中ガードレールは必須
- 外部API検証はprovider単位で判定（混在許可）
- 本番ではMOCK自動代替を禁止し、`DEGRADED` を明示
- adapter追加が必要なproviderはskillベースで標準化して対応
