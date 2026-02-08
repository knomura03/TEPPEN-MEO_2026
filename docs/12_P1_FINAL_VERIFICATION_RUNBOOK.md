# TEPPEN MEO：P1最終確認 + P2基盤スモーク手順書

最終更新: 2026-02-08（P3-02追記）

この手順書は、P1の各チケットを「本当に使える状態か」をGUI中心で確認するための手順です。  
今後は **開発チケットごとに本書へ追記** し、実装と同時に更新します。

## 0. 実施ルール（必読）
- 1チケットごとに「実施手順」「期待結果」「失敗時の確認」を必ず記録する
- 失敗したら次へ進まず、スクショを残して修正する
- 確認環境は原則 `staging`、`production` は承認後に同手順を短縮実施する

## 1. 共通準備（最初に1回）
1. TEPPEN MEOにログインする
2. 右上の店舗セレクタで対象店舗を選ぶ
3. 「設定 → SNS連携設定」で対象providerの接続状態を確認する
4. ブラウザを1回リロードする（古い状態を避けるため）

期待結果:
- 画面が正常表示され、対象店舗のデータが読める

補足（SNS連携の事前確認）:
- `設定を保存` / `接続テスト` が `status=401` で失敗する場合は、`admin-provider-secret-upsert` / `admin-provider-connection-test` / `admin-create-user` を最新 `index.ts` で再Deployしてから再実施する

---

## 2. P1-01 アンケート作成/公開

### 2-1. 作成と公開
1. 「アンケート」画面を開く
2. タイトル・説明・口コミURLを入力して「下書き保存」
3. 対象アンケートで「公開」を押す
4. 公開URLを開く（`/#/survey/<token>`）

期待結果:
- 公開URLでアンケート画面が開く
- 公開後、管理画面でステータスが `PUBLISHED` になる

### 2-2. 回答保存
1. 公開URLで星評価とコメントを入力して送信
2. 管理画面へ戻り、回答数が増えていることを確認

期待結果:
- 回答が保存され、回答数が +1 される

失敗時の確認:
- `supabase/migrations/202602060002_p1_surveys.sql` が適用済みか

---

## 3. P1-02 分岐導線（高評価/低評価）

### 3-1. しきい値設定
1. アンケート編集で「高評価しきい値」を設定（例: 4）
2. 保存する

期待結果:
- 保存後も設定値が保持される

### 3-2. 分岐確認
1. 公開URLで `4` 以上を送信する
2. 公開URLで `3` 以下を送信する

期待結果:
- `4` 以上は口コミURL導線（高評価導線）へ進む
- `3` 以下は不満回収として完了する
- DBの `survey_responses.branch_type` に `POSITIVE` / `NEGATIVE` が正しく入る

失敗時の確認:
- `supabase/migrations/202602060003_p1_survey_branching.sql` が適用済みか

---

## 4. P1-03 指標/CSV

### 4-1. 指標表示
1. 公開URLを開いて閲覧イベントを発生させる
2. 回答を1件以上送信する
3. アンケート管理画面で指標カードを確認する

期待結果:
- `閲覧数 / 回答数 / 回答率 / 分岐率 / 遷移クリック率` が表示される

### 4-2. CSV出力
1. 「CSVダウンロード」を押す
2. ダウンロードしたCSVを開く

期待結果:
- `response_id, survey_id, rating, branch_type, comment, source, created_at` が出力される

失敗時の確認:
- `supabase/migrations/202602060004_p1_survey_metrics.sql` が適用済みか

---

## 5. P1-04 口コミ依頼QR/POP

### 5-1. QR生成
1. 公開済みアンケートを開く
2. 「QR画像」を押す

期待結果:
- 公開URLが埋め込まれたQR画像を取得できる

### 5-2. POP印刷
1. 同じアンケートで「POP印刷（PDF）」を押す
2. 印刷プレビューを確認する

期待結果:
- タイトル・説明・QRを含むPOPが表示される

失敗時の確認:
- ブラウザのポップアップブロックを解除する

---

## 6. P1-05 口コミAI返信案（承認前保留）

### 6-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060005_p1_review_ai_reply_drafts.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `inbox_messages` に下書き関連列が作成される

### 6-2. AI返信案生成
1. 「受信箱」を開き、未返信メッセージを選択する
2. 「AI返信案を作成」を押す

期待結果:
- 下書きが本文欄に入る
- メッセージに `承認前保留` バッジが表示される

### 6-3. 承認送信
1. 下書き文面を必要に応じて修正する
2. 「承認して送信」を押す

期待結果:
- 返信が送信済み表示になる
- 下書きステータスが `APPROVED` になる

失敗時の確認:
- エラーが `P1-05 migration（reply_draft列）の適用後に再試行してください。` の場合は migration 未適用

---

## 7. P1-06 承認ワークフロー（作成→承認→公開準備）

### 7-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060006_p1_post_approval_workflow.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `posts` に承認関連列が追加される

### 7-2. USERで承認申請を作成
1. USERアカウントでログインする
2. 「新規投稿作成」で投稿内容を入力する
3. 「承認申請を作成」を押す
4. 「投稿管理」で対象投稿を確認する

期待結果:
- 投稿に `承認待ち` バッジが表示される

### 7-3. MANAGER/ADMINで承認
1. MANAGERまたはADMINでログインする
2. 「投稿管理」で承認待ち投稿を開く
3. 「承認」を押す

期待結果:
- 投稿に `承認済み` バッジが表示される
- 予約日時がある場合は `予約済み` と併記される

### 7-4. 差し戻し確認
1. 承認待ち投稿で「差し戻し」を押す
2. 任意で理由を入力して確定する
3. USER側で同投稿を確認する

期待結果:
- `差し戻し` バッジが表示される
- 理由を入力した場合は投稿一覧に理由が表示される
- USERは「承認申請」で再申請できる

失敗時の確認:
- エラーが `P1-06 migration（posts approval列）の適用後に再試行してください。` の場合は migration 未適用

---

## 8. P1-07 差戻しコメント履歴

### 8-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060007_p1_post_rejection_comment_history.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `post_approval_comments` テーブルが作成される

### 8-2. 差し戻し履歴の作成
1. USERで承認申請を作成する（P1-06の手順）
2. MANAGERまたはADMINで「差し戻し」を実行し、理由を入力する
3. 同じ投稿で「履歴」を開く

期待結果:
- 履歴に `承認申請` と `差し戻し` が時系列で表示される
- 差し戻し理由が履歴本文として表示される

### 8-3. 修正コメントの追記
1. MANAGERまたはADMINで「履歴」を開く
2. 「修正コメントを追加」に入力し、「コメント追加」を押す

期待結果:
- 履歴に `コメント` が追加される
- USERが同じ投稿の履歴を開いた際にコメントを閲覧できる

失敗時の確認:
- エラーが `P1-07 migration（post_approval_comments）の適用後に再試行してください。` の場合は migration 未適用

---

## 9. P1-08 店舗グループ管理（CRUD/権限制御）

### 9-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060008_p1_store_group_management.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `store_groups` / `store_group_stores` テーブルが作成される

### 9-2. グループ作成
1. MANAGERまたはADMINで「ユーザー・契約管理」を開く
2. 「店舗グループ管理」カードで「グループ追加」を押す
3. グループ名・説明・対象店舗を選択して「作成」を押す

期待結果:
- 一覧に新しいグループが表示される
- 対象店舗数と店舗名チップが表示される

### 9-3. グループ編集/削除
1. 既存グループの「編集」を押す
2. 店舗の追加/除外を行い「更新」を押す
3. 必要に応じて「削除」を押す

期待結果:
- 編集後の店舗構成が一覧へ反映される
- 削除したグループは一覧から消える

失敗時の確認:
- エラーが `P1-08 migration（store_groups）の適用後に再試行してください。` の場合は migration 未適用
- 権限エラーの場合は、実施アカウントが `MANAGER` 以上か確認する

---

## 10. P1-08拡張 店舗ライフサイクル是正 + CSV一括店舗作成

### 10-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060009_p1_store_lifecycle_and_csv_import.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `org_store_policies` / `user_store_controls` が作成される
- `create_store_for_actor` / `bulk_create_stores_for_user` が利用可能になる

### 10-2. 店舗0件USERのGUI復旧
1. 店舗0件のUSERでログインする
2. 「設定 → 店舗情報(MEO)」を開く
3. 店舗名・住所・電話・カテゴリを入力して「店舗を作成」を押す

期待結果:
- SQL Editor操作なしで店舗作成できる
- 作成後に店舗セレクタへ反映される

### 10-3. USER上限制御
1. ADMINまたはMANAGERで「ユーザー・契約管理」を開く
2. 対象USERの上限を `1` に設定して保存する
3. 対象USERで2件目店舗をGUI作成する

期待結果:
- 上限超過エラーで作成が拒否される
- エラーに現在件数/上限が表示される

### 10-4. CSV一括店舗作成（ON/OFF）
1. ADMINまたはMANAGERで対象USERの「CSV一括店舗作成」を `ON` にする
2. テンプレートCSVをダウンロードし、2行分入力してアップロード
3. 「CSV一括作成を実行」を押す

期待結果:
- 実行成功時のみ全件作成される
- 対象USERの店舗数が増える

### 10-5. CSV異常系（全体失敗）
1. 必須列欠落またはヘッダ不一致のCSVをアップロードする
2. 上限超過となる行数でCSVを実行する

期待結果:
- 行番号付きエラーが表示される
- 1件でも不正時は 0件作成（部分成功なし）

### 10-6. 権限/表示
1. USERアカウントで他店舗データにアクセスを試す
2. USER画面でCSV一括設定変更を試す

期待結果:
- USERは自身所属店舗のみアクセス可能
- USERは管理設定を変更できない

## 11. P1-09 一括投稿 / 一括設定（店舗グループ単位）

### 11-1. 一括投稿（新規投稿）
1. ADMINまたはMANAGERでログインする
2. 「新規投稿作成」を開く
3. 「投稿対象」で `店舗グループ` を選ぶ
4. 任意のグループを選び、投稿先・本文・日時を入力して保存する

期待結果:
- グループ内店舗数と同じ件数の投稿が作成される
- 予約日時ありなら `予約`、なしなら `下書き` で保存される
- USERでは `店舗グループ` 選択肢が表示されない

### 11-2. 一括設定（ユーザー・契約管理）
1. ADMINでログインする
2. 「ユーザー・契約管理」→「店舗グループ管理」へ進む
3. 「店舗グループ一括設定（機能公開）」で
   - 対象グループ
   - 設定対象（例: `create_post`）
   - 公開状態（`HIDDEN / ADMIN_ONLY / ENABLED`）
   を選んで実行する

期待結果:
- 対象グループ全店舗へ同じ公開状態が反映される
- 成功通知に反映店舗数が表示される
- MANAGERでは実行ボタンが無効である

### 11-3. 異常系
1. 店舗0件のグループを選んで実行する
2. グループ未選択で実行する

期待結果:
- 実行が拒否され、エラーメッセージが表示される
- 既存設定は変更されない

## 12. P2-01 OAuth共通基盤（IG/FB/GBP）

### 12-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060010_p2_oauth_common_foundation.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `oauth_sessions` テーブルと OAuth RPC が利用可能になる

### 12-2. OAuth開始
1. ADMINまたはMANAGERでログインする
2. 「設定 → SNS連携設定」を開く
3. OAUTH2 provider（Facebook/Instagram/GBP）の「連携する」を押す

期待結果:
- OAuthモーダルが開く
- 認可URLが表示される
- `oauth_sessions.status = PENDING` のセッションが作成される

### 12-3. OAuth完了
1. OAuthモーダルで任意の認可コードを入力する
2. 「接続を完了」を押す

期待結果:
- 接続完了トーストが表示される
- providerカードの `connection` が `CONNECTED` になる
- `integrations.status = CONNECTED` が保存される

### 12-4. OAuth解除
1. 同じproviderの「連携解除」を押す

期待結果:
- 解除トーストが表示される
- `connection = DISCONNECTED` に戻る
- `integration_credentials` が破棄される

### 12-5. 権限/異常系
1. USERロールで同画面を開く
2. OAUTH2 provider操作を試す

期待結果:
- USERでは OAuth操作が拒否される（権限エラー）
- 店舗未選択時は開始不可の警告が出る

## 13. P2-02 Instagram投稿連携

### 13-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060011_p2_instagram_publish.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `post_publish_logs` テーブルが作成される

### 13-2. Function配備確認（必須）
1. Supabase Functionsで `instagram-publish-post` が配備済みであることを確認する
2. `Verify JWT = OFF` になっていることを確認する

期待結果:
- 投稿一覧からREAL投稿実行時にFunctionが呼ばれる

### 13-3. MOCK実行確認
1. Instagram providerを未接続状態にする（またはGUI設定を未完了にする）
2. Instagram対象の承認済み投稿で「Instagram投稿」を押す

期待結果:
- 投稿が `PUBLISHED` になる
- `post_publish_logs` に `mode=MOCK, status=SUCCESS` が記録される

### 13-4. REAL実行確認
1. Instagram providerを `CONNECTED` 状態にする
2. 画像あり・承認済み・Instagram対象投稿で「Instagram投稿」を押す

期待結果:
- 成功時: `PUBLISHED` + `post_publish_logs.mode=REAL,status=SUCCESS`
- 失敗時: `FAILED` + `post_publish_logs.mode=REAL,status=FAILED`

### 13-5. 異常系
1. 画像なし投稿で実行する
2. 承認前投稿で実行する
3. 未来の予約投稿で実行する

期待結果:
- 実行が拒否される
- エラーメッセージがトースト表示される

## 14. P2-03 Facebook投稿/返信連携

### 14-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060012_p2_facebook_publish_reply.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `inbox_reply_logs` テーブルが作成される

### 14-2. Function配備確認（必須）
1. Supabase Functionsで次の2関数が配備済みであることを確認する
   - `facebook-publish-post`
   - `facebook-reply-message`
2. 両関数とも `Verify JWT = OFF` になっていることを確認する

期待結果:
- 投稿一覧/受信箱のREAL実行でFunctionが呼ばれる

### 14-3. Facebook投稿（MOCK実行）
1. Facebook providerを未接続状態にする（またはGUI設定を未完了にする）
2. Facebook対象の承認済み投稿で「Facebook投稿」を押す

期待結果:
- 投稿が `PUBLISHED` になる
- `post_publish_logs` に `provider=FACEBOOK, mode=MOCK, status=SUCCESS` が記録される

### 14-4. Facebook投稿（REAL実行）
1. Facebook providerを `CONNECTED` 状態にする
2. Facebook対象の承認済み投稿で「Facebook投稿」を押す

期待結果:
- 成功時: `PUBLISHED` + `post_publish_logs.mode=REAL,status=SUCCESS`
- 失敗時: `FAILED` + `post_publish_logs.mode=REAL,status=FAILED`

### 14-5. Facebook返信（MOCK実行）
1. 受信箱でFacebookメッセージ（未返信）を開く
2. providerを未接続状態にして返信送信を実行する

期待結果:
- メッセージが返信済みになる
- `inbox_reply_logs` に `provider=FACEBOOK, mode=MOCK, status=SUCCESS` が記録される

### 14-6. Facebook返信（REAL実行）
1. Facebook providerを `CONNECTED` 状態にする
2. 同様に未返信Facebookメッセージへ返信送信する

期待結果:
- 成功時: `inbox_messages.is_replied = true` + `inbox_reply_logs.mode=REAL,status=SUCCESS`
- 失敗時: `inbox_reply_logs.mode=REAL,status=FAILED`

### 14-7. 異常系
1. 承認前投稿でFacebook投稿を実行する
2. 未来予約投稿でFacebook投稿を実行する
3. 返信済みFacebookメッセージへ再返信を実行する

期待結果:
- それぞれ実行が拒否され、トーストで理由が表示される

## 15. P2-04 受信箱高度化（タグ/担当/SLA）

### 15-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060013_p2_inbox_advanced_workflow.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `inbox_messages` に `tags / assigned_user_id / due_at / sla_status` が追加される

### 15-2. タグ保存
1. 「統合受信箱」を開く
2. 未返信メッセージを選択する
3. ワークフロー管理のタグ欄に `要返信, クレーム` のように入力して「ワークフローを保存」を押す

期待結果:
- 保存成功トーストが表示される
- 一覧にタグチップが表示される

### 15-3. 担当者割当
1. 同じメッセージで担当者を選択して保存する
2. 別の担当者へ変更して再保存する

期待結果:
- 担当者名が一覧・詳細に反映される
- 店舗メンバー以外は候補に表示されない

### 15-4. 期限/SLA確認
1. 期限を「現在から6時間後」に設定して保存する
2. 期限を「現在より過去」に変更して保存する

期待結果:
- 6時間後設定時は `AT_RISK`
- 過去時刻設定時は `OVERDUE`

### 15-5. 返信完了時のSLA
1. 上記メッセージに返信を送信する

期待結果:
- 返信後は `返信済み` になる
- SLAが `COMPLETED` に変わる

### 15-6. 異常系
1. migration未適用環境でワークフロー保存を実行する
2. 不正な期限形式を入力して保存する

期待結果:
- migration未適用時は専用エラーを表示し保存しない
- 不正入力はUI側でエラー表示される

## 16. P2-05 テンプレ/ブランドキット

### 16-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060014_p2_template_brand_kit.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `brand_kits` / `post_templates` が作成される

### 16-2. ブランドキット保存
1. 「設定 → システム管理」を開く
2. ブランドキット欄に次を入力して保存する
   - トーンガイド（例: 誠実・簡潔）
   - NGワード（例: 絶対, 100%保証）
   - 推奨ハッシュタグ（例: #TEPPENMEO）
   - デフォルト署名（例: ご来店お待ちしています）

期待結果:
- 保存成功トーストが表示される
- 再表示時に入力値が保持される

### 16-3. テンプレート作成/削除
1. 同画面でテンプレート名・本文・投稿先を指定して「テンプレートを作成」を押す
2. 作成後のテンプレート一覧に表示されることを確認する
3. 1件を「削除」して一覧から消えることを確認する

期待結果:
- 作成成功トーストが表示される
- 削除は論理削除として扱われ、一覧から非表示になる

### 16-4. 投稿画面連動
1. 「新規投稿作成」を開く
2. 「テンプレート適用」を押す
3. 推奨ハッシュタグを1つクリックして本文追記を確認する
4. NGワードを本文に入れて警告表示を確認する

期待結果:
- テンプレ本文と署名が本文に反映される
- 推奨タグ未使用/NGワードの警告が本文に応じて更新される

### 16-5. 異常系
1. migration未適用環境でブランドキット取得を試す
2. テンプレート名または本文を空で作成を試す

期待結果:
- migration未適用時は専用エラーを表示する
- 必須未入力時は作成拒否し、入力エラーを表示する

## 17. P3-01 順位キーワード管理

### 17-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060015_p3_rank_keyword_management.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `rank_keywords` が作成される

### 17-2. 一覧/追加
1. 右上の店舗セレクタで対象店舗を選ぶ
2. 左メニューの「順位計測」を開く
3. 「キーワード追加」で `渋谷 ラーメン` のようなキーワードを入力して追加する

期待結果:
- 追加成功トーストが表示される
- 一覧に追加したキーワードが表示される

### 17-3. 編集/削除
1. 一覧のキーワードで「編集」を押す
2. キーワード/メモを更新して保存する
3. 同じ行で「削除」を押し、確認ダイアログでOKする

期待結果:
- 編集結果が一覧へ反映される
- 削除後は一覧から非表示になる（論理削除）

### 17-4. 異常系
1. 同じキーワードをもう一度追加する
2. 80文字を超えるキーワードを追加する

期待結果:
- 重複は拒否される
- 80文字超は保存できない

## 18. P3-02 日次順位収集ジョブ

### 18-1. migration確認（必須）
1. Supabase SQL Editorで `supabase/migrations/202602060016_p3_rank_daily_collection.sql` を実行する
2. `Success. No rows returned` になることを確認する

期待結果:
- `rank_collection_runs` / `rank_collection_results` が作成される

### 18-2. 手動収集（MOCK）実行
1. 右上の店舗セレクタで対象店舗を選ぶ
2. 左メニューの「順位計測」を開く
3. 「収集実行（MOCK）」を押す

期待結果:
- 収集完了トーストが表示される
- 実行履歴に新しいrunが追加される

### 18-3. 実行履歴/結果確認
1. 実行履歴から最新runを選択する
2. 右側の結果一覧を確認する

期待結果:
- キーワードごとに順位（`n位`）が表示される
- mode/statusが `MOCK/SUCCESS` で表示される

### 18-4. 異常系
1. キーワード0件の店舗で「収集実行（MOCK）」を押す
2. （将来REAL導線用）`mode=REAL` 実行時の失敗メッセージを確認する

期待結果:
- キーワード0件でも `SUCCESS` で完了し、runに0件完了メッセージが残る
- REAL未実装時は `FAILED` で明示的に終了する（MOCKへ自動代替しない）

## 19. 記録テンプレート（毎チケット共通）
実施後は、以下をチケットコメントまたはメモに残します。

- 実施日時:
- 実施者:
- 対象チケット:
- 対象店舗:
- 実施結果: `OK` / `NG`
- NG時のスクショ保存先:
- 次アクション:
