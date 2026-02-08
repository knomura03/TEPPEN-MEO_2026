# TEPPEN MEO：テスト方針と品質ルール（Phase1〜Phase3）

最終更新: 2026-02-08（P2-05追記）

この方針書は、`Step2集中テスト` を成立させるための品質基準です。  
実装中の最低限ガードレールを明示し、終盤破綻を防ぎます。

## 1. テスト目的と品質原則
### 目的
- 実装速度と本番品質を両立する
- provider追加時に毎回同じ品質で検証できるようにする
- 障害時の挙動（`DEGRADED` / `BLOCKED`）を事前に保証する

### 品質原則
- 再現性: 同じ入力で同じ結果が出る
- 独立性: テスト同士が状態を汚染しない
- 可観測性: 失敗時に原因を追えるログ/証跡を残す
- 最小権限: 非ADMINが管理系機能へ到達できない

## 2. Step2集中テストの運用定義
### 方針
- Step1（実装中）はガードレールのみ実施
- Step2でユニット/統合/E2Eを一括実行
- Step3で不具合修正と再検証

### Step2で必ず実施すること
- provider別 `REAL/MOCK` テスト行列の作成
- 主要導線E2E（ログイン→投稿→受信箱→設定）
- 権限/RLS/Feature Flag/Secretsの回帰
- 受入証跡（テストレポート、画面証跡、失敗ログ）保存

## 3. 実装中ガードレール（必須スモーク）
すべての実装チケットで以下を必須化します。
- `npm run typecheck`
- `npm run build`
- 契約スモーク（adapter解決/権限/flag判定）

### 契約スモークの最低項目
- 未登録providerでadapter解決が失敗しても全体クラッシュしない
- 非ADMINがSecrets更新APIを叩いても拒否される
- `HIDDEN/ADMIN_ONLY/ENABLED` 判定がUI/APIで一致する

## 4. テストレイヤー（Vitest/RTL/Playwright）
### 4.1 Unit（Vitest）
- 判定ロジック（provider readiness、visibility、runtime mode）
- バリデーション（Secrets入力、設定整合）
- 変換ロジック（provider_key、capabilities）

### 4.2 Integration（Vitest + RTL）
- 管理画面のprovider追加フロー
- Secrets設定/更新フロー
- Feature Flagによる表示切替
- 権限拒否時のUI/エラーメッセージ

### 4.3 E2E（Playwright）
- ADMIN: provider追加→設定→接続テスト→公開切替
- USER: 許可機能のみ利用可能
- 障害時: `DEGRADED` 表示と制限動作

### 4.4 推奨ディレクトリ
- `tests/unit/`
- `tests/integration/`
- `tests/e2e/`
- `tests/fixtures/`

## 5. provider別 REAL/MOCK 判定ルール
### 5.1 検証モード（test_mode）
- 条件を満たせば `REAL`、未充足なら `MOCK`
- 判定はprovider単位で独立（混在許可）

### 5.2 判定入力
- `has_gui_config`
- `has_adapter`（`NATIVE` のみ必須）
- `connection_status`

### 5.3 判定表（検証モード）
| 条件 | 結果 |
|---|---|
| GUI設定あり +（GENERIC or adapterあり）+ 接続OK | `REAL` |
| 上記のいずれか欠落 | `MOCK` |

### 5.4 混在例
- GBP = `REAL`, Instagram = `MOCK`, Facebook = `MOCK` を許可

## 6. 本番実行時の失敗挙動（MOCK代替禁止、DEGRADED）
本番では `MOCK` への自動代替を禁止します。

### runtime_mode定義
- `ACTIVE`: 実行可能
- `DEGRADED`: 一部機能制限で継続（例: 投稿停止、受信のみ）
- `BLOCKED`: 実行停止（接続不能/重大設定欠落）

### 必須テスト
- 接続断時に `DEGRADED` 表示へ遷移する
- `BLOCKED` で危険操作を実行不可にする
- 障害復旧後に `ACTIVE` へ戻る

## 7. 合格ゲート（重大不具合ゼロ + 主要導線全通）
### リリース判定の必須条件
- `typecheck` 成功
- `build` 成功
- 主要導線E2E全通
- Blocker/Critical = 0
- provider別 `REAL/MOCK` 判定結果が記録されている

### 補足
- 初期段階ではカバレッジ閾値を固定しない
- 代わりに重要導線の失敗ゼロを優先する

## 8. 外部API受入（GUI設定済みproviderのみ実データ検証）
### 受入ルール
- GUI設定済みproviderだけ実データ受入を実施
- 未設定providerはモック受入で代替
- 受入証跡はproviderごとに保存する

### 受入証跡（必須）
- 実行日時
- 対象provider
- `test_mode`
- 成功/失敗
- 画面証跡またはログID

## 9. 不具合優先度/SLA/再発防止ルール
| 優先度 | 定義 | 修正SLA |
|---|---|---|
| Blocker | リリース不能、データ破壊/権限漏れ | 即時対応（当日） |
| Critical | 主要導線停止、重大障害 | 24時間以内 |
| Major | 代替手段ありだが業務影響大 | 3営業日以内 |
| Minor | 軽微な不整合 | 次スプリント |

### 再発防止の必須項目
- 原因分類（設計/実装/設定/運用）
- 防止策（テスト追加/ガード追加/手順修正）
- 監査ログと運用手順書の更新

## 10. リリース可否判定テンプレート
以下を満たした場合のみリリース可とします。

### 10.1 チェック項目
- [ ] Step2テスト一式が完了
- [ ] Blocker/Criticalが0件
- [ ] provider別 `REAL/MOCK` 判定が妥当
- [ ] `DEGRADED/BLOCKED` の動作確認済み
- [ ] feature flag初期値が `ADMIN_ONLY` で設定済み
- [ ] 監査ログ記録の確認済み
- [ ] 復旧手順（forward fix）が確認済み

### 10.2 判定結果の記録フォーマット
- 判定日:
- 判定者:
- 対象チケット:
- 対象provider:
- 主要テスト結果:
- 残課題:
- リリース可否: `GO` / `NO-GO`

## 11. 店舗ライフサイクル/CSV一括作成の品質ルール（P1-08拡張）
### 11.1 必須シナリオ
- 店舗0件USERがGUIのみで初回店舗を作成できる
- USERは自分の所属店舗以外を操作できない
- 上限超過時に作成拒否され、現在件数/上限が明示される
- ADMIN/MANAGERがUSERごとの上限とCSV ON/OFFを更新できる

### 11.2 CSV検証ルール（固定）
- テンプレヘッダ完全一致（順序含む）
- 必須列: `store_name,address,phone,category`
- 行数上限: 500
- 重複禁止: 同一CSV内の `store_name + phone`
- URL検証: `website` がある場合のみ `http/https`

### 11.3 実行時ルール
- `allow_csv_store_bulk_create = OFF` のUSERは実行拒否
- `current_count + valid_rows > effective_limit` は実行拒否
- 1件でも不正があれば全体失敗（0件作成）
- エラーは `line,column,code,message` で返却

### 11.4 回帰観点（最低限）
- `user_has_store_access` が `USER + store_id null` を許可しない
- 招待ユーザー（初期店舗なし）が後で店舗作成できる
- モーダルのスモークがビューポート全体で一致（Portal描画）

## 12. P1-09 一括投稿/一括設定の品質ルール
### 12.1 一括投稿（店舗グループ）
- ADMIN/MANAGERのみ `店舗グループ` を投稿対象に選択できる
- 対象店舗数と作成投稿数が一致する
- 作成途中エラー時は作成済み投稿をロールバックし、部分成功を残さない
- 画像アップロード失敗時は投稿自体は保持し、失敗件数を通知する

### 12.2 一括設定（機能公開フラグ）
- 実行はADMINのみ許可（MANAGERは実行不可）
- 対象グループの全店舗へ同じ `feature_flags` 状態を反映する
- 対象店舗0件・グループ未選択は実行拒否する
- 反映件数（applied/skipped）を通知して運用ログに残せる

### 12.3 回帰観点
- 単一店舗投稿（従来導線）が劣化していない
- USERロールで一括投稿UIが表示されない
- `feature_flags` の既存org設定（store_id null）を壊さない
- Supabase未設定時は既存どおりモック動作でクラッシュしない

## 13. P2-01 OAuth共通基盤の品質ルール
### 13.1 必須シナリオ
- OAUTH2 providerで `連携する` を押すと OAuth開始セッションが作成される
- 認可コード入力で `CONNECTED` に遷移する
- `連携解除` で `DISCONNECTED` に戻る
- 期限切れstateは `STATE_EXPIRED` で拒否される

### 13.2 権限とセキュリティ
- USERロールは OAuth開始/完了/解除RPCを実行できない
- `oauth_sessions` はクライアント直接参照できない（RLS deny-all）
- OAuth対象外provider（`auth_kind != OAUTH2`）は RPC 実行拒否

### 13.3 回帰観点
- API_KEY providerの保存/接続テスト導線が壊れていない
- `integrations` と `integration_credentials` の更新が不整合を起こさない
- 接続失敗時にエラー文言がUIトーストへ正しく表示される

## 14. P2-02 Instagram投稿連携の品質ルール
### 14.1 必須シナリオ
- ADMIN/MANAGERが投稿一覧からInstagram投稿を実行できる
- `REAL` 条件を満たす場合はEdge Function経由でGraph APIを呼ぶ
- `REAL` 条件未達の場合は `MOCK` 投稿として成功記録する

### 14.2 異常系
- 画像なし投稿は `REAL` 実行時に失敗し、`FAILED` へ遷移する
- `approval_status != APPROVED` は投稿実行を拒否する
- 予約時刻前投稿は実行を拒否する
- Edge Function失敗時は `post_publish_logs` に `FAILED` が残る

### 14.3 記録/可観測性
- すべての投稿実行で `post_publish_logs` が1件以上作成される
- 成功時は `external_post_id` を保存する
- 失敗時は原因メッセージを保存する

### 14.4 回帰観点
- 既存の投稿作成・承認・差し戻し導線が劣化しない
- Instagram以外の投稿導線（GBP/Facebook表記）が壊れない
- Supabase未設定時のモック挙動が維持される

## 15. P2-03 Facebook投稿/返信連携の品質ルール
### 15.1 必須シナリオ
- ADMIN/MANAGERが投稿一覧からFacebook投稿を実行できる
- 統合受信箱からFacebook返信を実行できる
- `REAL` 条件を満たす場合はEdge Function経由でGraph APIを呼ぶ
- `REAL` 条件未達の場合は `MOCK` 実行として成功記録する

### 15.2 異常系
- `approval_status != APPROVED` の投稿は実行拒否する
- 未来予約投稿は投稿実行を拒否する
- 返信済みメッセージは再返信を拒否する
- Edge Function失敗時に投稿/返信ログへ `FAILED` が残る

### 15.3 記録/可観測性
- Facebook投稿実行ごとに `post_publish_logs` が作成される
- Facebook返信実行ごとに `inbox_reply_logs` が作成される
- 成功時は `external_post_id` / `external_reply_id` を保存する
- 失敗時は原因メッセージを保存する

### 15.4 回帰観点
- Instagram投稿実行（P2-02）が劣化していない
- 非Facebookメッセージ返信（既存保存処理）が劣化していない
- Supabase未設定時のモック挙動が維持される

## 16. P2-04 受信箱高度化（タグ/担当/SLA）の品質ルール
### 16.1 必須シナリオ
- 受信箱メッセージにタグを保存できる（重複除去・最大数制約）
- 店舗所属メンバーから担当者を割り当てられる
- 対応期限を保存するとSLAが `ON_TRACK/AT_RISK/OVERDUE` で変化する
- 返信送信後はSLAが `COMPLETED` になる

### 16.2 異常系
- migration未適用環境で保存した場合、専用エラー（workflow列不足）を返す
- 担当者が不正IDの場合、保存が拒否される
- 不正な期限フォーマット入力時は保存前にUIで弾く

### 16.3 記録/可観測性
- workflow更新後に `inbox_messages.tags/assigned_user_id/due_at/sla_status` が保存される
- 一覧と詳細画面の表示内容がDB保存値と一致する
- 検索/フィルタ（未返信/担当あり/SLA）結果が期待件数と一致する

### 16.4 回帰観点
- P1-05 AI返信案（承認前保留）導線が劣化しない
- P2-03 Facebook返信導線が劣化しない
- Supabase未設定時はモックデータでクラッシュしない

## 17. P2-05 テンプレ/ブランドキットの品質ルール
### 17.1 必須シナリオ
- 設定画面でブランドキット（トーン/NGワード/推奨タグ/署名）を保存できる
- 設定画面でテンプレートを作成し、投稿画面で適用できる
- 推奨タグのクリック追加が本文へ反映される
- 投稿本文にNGワードが含まれると警告表示される

### 17.2 異常系
- migration未適用環境では専用エラー（P2-05 migration適用案内）を表示する
- テンプレートの必須入力（title/body）が欠ける場合は作成を拒否する
- 不正プラットフォーム値は保存前に除外/拒否される

### 17.3 記録/可観測性
- `brand_kits` に1org1レコードで保存される
- `post_templates` は論理削除（`is_active=false`）で履歴を保持する
- 投稿画面の警告表示が入力本文に追従して即時更新される

### 17.4 回帰観点
- P1-06承認ワークフローの投稿保存が劣化しない
- P2-02/P2-03投稿実行導線の前提データ（posts）が劣化しない
- Supabase未設定時はテンプレート表示が空でも投稿画面が継続利用できる

---
## 明示的前提・デフォルト
- Step2集中方針は維持する
- 実装中ガードレールは必須で省略不可
- 外部APIはprovider単位で `REAL/MOCK` を判定する
- 本番での `MOCK` 自動代替は禁止し、`DEGRADED/BLOCKED` で運用する
