# knomura向け手順書（最小作業で進める）

最終更新: 2026-02-08（P3-01追記）

## この手順書の読み方
- 「どこをクリックするか」をそのまま書いています。
- 途中で不安になったら、**その画面のスクショ**と、**どこで止まったか**を送ってください。こちらで切り分けます。
- 用語が分からなくても大丈夫です（無理に理解しなくてOK）。

## P1機能の最終確認はこちら
- P1-01〜P1-09の最終動作確認は `docs/12_P1_FINAL_VERIFICATION_RUNBOOK.md` を使ってください。
- 今後のP1チケットもこの手順書へ追記していきます。

## P1-09（店舗グループ一括投稿/一括設定）の使い方
### 一括投稿（ADMIN/MANAGER）
1. 「新規投稿作成」を開く
2. 「投稿対象」で `店舗グループ` を選ぶ
3. 対象グループを選び、本文・投稿先・日時を入力して保存する

期待結果:
- グループ内の全店舗へ同じ投稿が作成されます。

### 一括設定（ADMINのみ）
1. 「ユーザー・契約管理」→「店舗グループ管理」を開く
2. 「店舗グループ一括設定（機能公開）」で対象グループを選ぶ
3. 設定対象機能と公開状態を選び、「一括設定を適用」を押す

期待結果:
- 対象グループの全店舗へ同じ公開状態が反映されます。

## knomuraにお願いする作業（まず最初）
### 1) Supabaseプロジェクトを作る（目安 10〜15分）
この作業で必要なのは、最後に表示される **2つの文字列（Project URL / anon key）** を共有してもらうことだけです。

#### 手順（クリック順）
1. Supabaseにログインする
2. ダッシュボードで「New project（新規プロジェクト）」を押す
3. 作成先の「Organization（組織）」を選ぶ（個人でもOK）
4. Project name（プロジェクト名）を入力（例: `teppen-meo`）
5. Database password（DBパスワード）を設定
   - ここは“ログインに必要なパスワード”ではありません
   - 後で使う可能性があるので、メモしておいてください
6. Region（リージョン）を選ぶ（日本に近い場所でOK）
7. 「Create project（作成）」を押す
8. 数分待つ（“Project is ready” のような表示になればOK）

#### Project URL / anon key を取得する
1. 左メニューの「Project Settings（歯車アイコン）」を押す
2. 「API」を開く
3. 次の2つを見つける
   - `Project URL`
   - `anon public key`（または `anon key`）
4. この2つを、こちらに共有してください（貼り付けでOK）

#### 共有時の注意
- `service_role key` という項目があっても、**それは共有しないでください**（シークレットです）。
- 共有するのは `Project URL` と `anon public key` の2つだけでOKです。

### 2) それ以外は基本的にこちらで対応
- DB設計・権限制御・実装・デプロイ・ジョブ・監視など

## （重要）管理者ユーザーをSupabaseに作成する（初回のみ）
TEPPEN MEOのログインには、**Supabase側にユーザーが存在している必要があります**。
最初の1回だけ、Supabaseの管理画面でユーザーを作成します。

### 手順（クリック順）
1. Supabaseダッシュボードを開く
2. 左メニューの「Authentication」を押す
3. 上部タブの「Users」を開く
4. 右上の「Add user」を押す
5. Email に **あなたのメールアドレス** を入力
6. Password を入力（忘れないようにメモ）
7. 「Create user」を押す
8. 画面に追加されたユーザーが表示されていればOK

※ このメール/パスワードで TEPPEN MEO にログインします。

## （重要）最初の「店舗が未設定」を解消する（GUIで完結）
現在は、店舗0件ユーザーでも **設定画面から初回店舗を作成** できます。  
原則として SQL Editor は不要です。

### 手順（クリック順）
1. TEPPEN MEOにログインする
2. 画面左下の「設定・プロフィール」を開く
3. 左タブの「店舗情報（MEO）」を開く
4. 店舗名・住所・電話・カテゴリを入力する
5. 「店舗を作成」を押す
6. 作成後、右上の店舗セレクタに店舗が表示されることを確認する

### もし作成に失敗したら
- 「店舗作成上限」に関するエラー: 管理者に上限変更を依頼してください
- それ以外のエラー: スクショを共有してください（こちらで切り分けます）
- 例外対応としてのみ `supabase/bootstrap.sql` を使います（通常運用では不要）

## （重要）投稿画像の保存先を作る（Storageバケット）
投稿画像を保存するために、SupabaseのStorageに「post-media」バケットを作成します。

### 手順（画面で作る場合）
1. Supabaseの左メニューで「Storage」を開く
2. 「New bucket」を押す
3. Name に `post-media` と入力
4. 「Public」は OFF（非公開）にする
5. 「Create bucket」を押す

※ SQLで作る場合は `supabase/storage.sql` を SQL Editor で実行してください。

## （重要）Storageのポリシーを設定する（GUIでOK）
投稿画像のアップロード/表示に必要な**アクセス許可**を設定します。

### 手順（クリック順）
1. Supabaseの左メニューで「Storage」を開く
2. `post-media` バケットをクリック
3. 上部タブの「Policies」を開く
4. 「New policy」を押す
5. それぞれ次の3つを作成します（同じ画面で繰り返し作成）

**A) Select（読み取り）**
- Policy name: `post_media_select`
- Allowed operations: `SELECT`
- USING expression:
  ```
  bucket_id = 'post-media'
  and auth.role() = 'authenticated'
  and public.user_has_store_access((split_part(name, '/', 1))::uuid)
  ```

**B) Insert（アップロード）**
- Policy name: `post_media_insert`
- Allowed operations: `INSERT`
- WITH CHECK expression:
  ```
  bucket_id = 'post-media'
  and auth.role() = 'authenticated'
  and public.user_has_store_access((split_part(name, '/', 1))::uuid)
  ```

**C) Delete（削除）**
- Policy name: `post_media_delete`
- Allowed operations: `DELETE`
- USING expression:
  ```
  bucket_id = 'post-media'
  and auth.role() = 'authenticated'
  and public.user_has_store_access((split_part(name, '/', 1))::uuid)
  ```

### もしエラーが出たら
- エラー画面をスクショして送ってください（ほぼ確実にこちらで解決できます）
  - よくある原因: メールの打ち間違い / まだユーザーが作成されていない

## （M2で追記）Google OAuth作成手順
GBP連携を進める段階（M2）で、ここに **スクショ付き**で追記します。
ゴールは「TEPPEN MEOの管理画面で“接続する”を押すだけ」で終わる形です。

## Supabase Functions（Edge Functions）について
### まず結論
- あなたのスクショの画面（`Edge Functions`）で合っています。
- ここでやる作業は「関数コードを貼る」「デプロイする」「Secretsを登録する」の3つです。
- TEPPEN MEOで使う関数は現在この3つです。
  - `admin-create-user`
  - `admin-provider-secret-upsert`
  - `admin-provider-connection-test`

### 用語を最小で理解する
- `Functions`: サーバー側で動く処理（ブラウザに秘密鍵を置かないため）
- `Secrets`: 関数だけが使う機密値（例: `SUPABASE_SERVICE_ROLE_KEY`）
- `Deploy`: 最新コードを有効化する操作

### Functionを新規作成する手順（クリック順）
1. Supabaseダッシュボードを開く
2. 左メニューで「Functions」を押す
3. 右上の「Deploy a new function」を押す
4. 名前を入力（例: `admin-create-user`）
5. 作成後、ブラウザ内のエディタを開く
6. リポジトリの対応ファイル（例: `supabase/functions/admin-create-user/index.ts`）を全コピー
7. エディタへ貼り付ける
8. 「Save」→「Deploy」を押す

### 既存Functionを更新する手順（クリック順）
1. 「Functions」一覧で対象関数名をクリック
2. 「Edit code」（またはエディタを開く）を押す
3. リポジトリ側の `index.ts` を全コピーして貼り替える
4. 「Save」→「Deploy」で更新

### Secretsを登録する手順（クリック順）
1. 左メニュー「Functions」内の「Secrets」を押す
2. 「Add new secret」を押す
3. Name/Valueを入力して保存

登録必須の値:
- `SUPABASE_SERVICE_ROLE_KEY`
  - 取得場所: `Project Settings -> API -> service_role`
- `PROVIDER_CONFIG_ENCRYPTION_KEY`（provider秘密情報を保存する時のみ）
  - 32文字以上のランダム文字列（英数混在推奨）

## （追加）新規ユーザー作成（招待）を使うための設定
「ユーザー・契約管理」画面から**招待メールを送る**ために、`admin-create-user` をデプロイします。

### 手順（クリック順）
1. 上の「Functionを新規作成する手順」で `admin-create-user` を作成
2. `supabase/functions/admin-create-user/index.ts` を貼り付けてDeploy
3. 上の「Secretsを登録する手順」で `SUPABASE_SERVICE_ROLE_KEY` を登録

### 確認
TEPPEN MEO の「ユーザー・契約管理」→「新規ユーザー作成」で招待メールが届けばOKです。

## （追加）USERの店舗上限・CSV一括作成を使うための設定
この機能は migration 適用後に使えます。

### 手順（クリック順）
1. Supabaseの「SQL Editor」を開く
2. `supabase/migrations/202602060009_p1_store_lifecycle_and_csv_import.sql` を貼り付けて実行
3. `Success. No rows returned` を確認
4. TEPPEN MEOで「ユーザー・契約管理」を開く
5. 対象USERの「店舗上限」「CSV一括店舗作成 ON/OFF」を設定して保存
6. 必要な場合のみ、テンプレートCSVを使って店舗一括作成を実行

### 注意
- CSVは1件でも不正があると全体失敗（0件作成）です
- 上限を超える行数のCSVは取り込めません

## （Phase0）Provider設定と接続テストを使うための設定
「設定 → SNS連携設定」でProvider追加・シークレット保存・接続テストを使う場合、Functionsを2つ追加します。

### 手順（クリック順）
1. 上の「Functionを新規作成する手順」で `admin-provider-secret-upsert` を作成
2. `supabase/functions/admin-provider-secret-upsert/index.ts` を貼り付けてDeploy
3. もう一度、同じ手順で `admin-provider-connection-test` を作成
4. `supabase/functions/admin-provider-connection-test/index.ts` を貼り付けてDeploy

### シークレット設定（超重要）
Functionsの「Secrets」で以下を登録します。
- `SUPABASE_SERVICE_ROLE_KEY`（既存と同じ）
- `PROVIDER_CONFIG_ENCRYPTION_KEY`（32文字以上のランダム文字列）

### `PROVIDER_CONFIG_ENCRYPTION_KEY` とは
- これは「どこかから受け取るキー」ではありません。
- **あなたのプロジェクト専用に、新規で1つ作る秘密文字列**です。
- 役割は、providerのシークレット値（APIキー等）をDB保存前に暗号化することです。
- 目安は32文字以上（英数字）です。64文字の16進文字列でOKです。

### `PROVIDER_CONFIG_ENCRYPTION_KEY` 作成手順（最短）
1. Codexから受け取ったランダム文字列（32文字以上）をコピー
2. Supabase `Functions -> Secrets` で `Name` に `PROVIDER_CONFIG_ENCRYPTION_KEY` を入力
3. `Value` に貼り付けて `Save`

### 注意
- この値は外部公開しないでください（service role keyと同等に重要）
- 将来ローテーション可能ですが、変更時は手順書に沿って実施します

### 動作確認
1. TEPPEN MEOにADMINでログイン
2. 「設定 → SNS連携設定」を開く
3. Providerを1つ選んで設定JSONを保存
4. シークレットを入力して保存
5. 「接続テスト」を押す
6. 接続状態が `CONNECTED` または `ERROR` で更新されればOK

### 補足（重要）
- 現時点の `接続テスト` は「外部APIへの実通信」ではなく、**設定JSONとSecretが保存されているか**の確認です。
- つまり `CONNECTED` は「接続準備が完了」の意味です（本番APIの疎通試験は後続Phaseで拡張予定）。

## （P2-01）OAuth共通基盤を有効化する手順（IG/FB/GBP）
OAuthの「連携する/連携解除」ボタンを使うには、P2-01 migrationが必要です。

### 手順（クリック順）
1. Supabaseの「SQL Editor」を開く
2. `supabase/migrations/202602060010_p2_oauth_common_foundation.sql` を貼り付けて実行
3. `Success. No rows returned` を確認する
4. TEPPEN MEOを再読み込みして「設定 → SNS連携設定」を開く

### 動作確認（最小）
1. OAUTH2 provider（Facebook / Instagram / GBP）を選ぶ
2. 「連携する」を押す
3. OAuthモーダルに認可URLが表示されることを確認
4. 仮の認可コードを入力して「接続を完了」を押す
5. カードの `connection` が `CONNECTED` になることを確認
6. 「連携解除」を押し、`DISCONNECTED` に戻ることを確認

### 失敗時の確認ポイント
- migration `202602060010` が未適用
- 実施アカウントが `ADMIN` / `MANAGER` ではない
- 対象providerの `auth_kind` が `OAUTH2` でない
- 店舗未選択（右上セレクタ未選択）

## （P2-02）Instagram投稿連携を有効化する手順
投稿一覧の「Instagram投稿」ボタンをREAL実行するには、migrationとFunction配備が必要です。

### 手順1: migration適用
1. Supabaseの「SQL Editor」を開く
2. `supabase/migrations/202602060011_p2_instagram_publish.sql` を貼り付けて実行
3. `Success. No rows returned` を確認する

### 手順2: Edge Function配備
1. Supabaseの「Functions」を開く
2. 「Deploy a new function」を押し、名前を `instagram-publish-post` にする
3. `supabase/functions/instagram-publish-post/index.ts` を全コピーして貼り付ける
4. `Save` → `Deploy` を実行する
5. `Details` タブで `Verify JWT` を `OFF` にする

### 手順3: GUIで実行確認
1. TEPPEN MEOでADMINまたはMANAGERでログイン
2. 「投稿一覧」を開く
3. Instagramを含む承認済み投稿で「Instagram投稿」を押す

期待結果:
- REAL条件を満たす場合: Instagram投稿が実行される
- 条件未達の場合: MOCK投稿として成功扱いで記録される
- いずれも `post_publish_logs` に履歴が残る

### REAL条件（この4つ）
- `provider_catalog(INSTAGRAM).can_publish = true`
- `provider_configurations.has_gui_config = true`
- `provider_configurations.connection_status = CONNECTED`
- `integrations.status = CONNECTED`

## （P2-03）Facebook投稿/返信連携を有効化する手順
投稿一覧の「Facebook投稿」と受信箱の「Facebook返信」をREAL実行するには、migrationとFunction配備が必要です。

### 手順1: migration適用
1. Supabaseの「SQL Editor」を開く
2. `supabase/migrations/202602060012_p2_facebook_publish_reply.sql` を貼り付けて実行
3. `Success. No rows returned` を確認する

### 手順2: Edge Function配備
1. Supabaseの「Functions」を開く
2. 「Deploy a new function」を押し、名前を `facebook-publish-post` にする
3. `supabase/functions/facebook-publish-post/index.ts` を全コピーして貼り付ける
4. `Save` → `Deploy` を実行する
5. `Details` タブで `Verify JWT` を `OFF` にする
6. 同じ手順で `facebook-reply-message` も作成し、`index.ts` を貼り付けて `Deploy` する
7. `facebook-reply-message` も `Verify JWT = OFF` にする

### 手順3: Facebook provider設定（GUI）
1. TEPPEN MEOで「設定 → SNS連携設定」を開く
2. Facebookの「Provider設定（Admin）」で設定JSONに `page_id`（または `facebook_page_id`）を入れる
3. シークレット欄にアクセストークンを入力して「設定を保存」
4. 「接続テスト」を押して `CONNECTED` を確認

### 手順4: GUIで投稿実行確認
1. ADMINまたはMANAGERで「投稿一覧」を開く
2. Facebookを含む承認済み投稿で「Facebook投稿」を押す

期待結果:
- REAL条件を満たす場合: Facebook投稿が実行される
- 条件未達の場合: MOCK投稿として成功扱いで記録される
- いずれも `post_publish_logs` に履歴が残る

### 手順5: GUIで返信実行確認
1. ADMINまたはMANAGERで「統合受信箱」を開く
2. Facebookメッセージ（未返信）を選び、返信文を入力して送信

期待結果:
- REAL条件を満たす場合: Facebook返信が実行される
- 条件未達の場合: MOCK返信として成功扱いで記録される
- いずれも `inbox_reply_logs` に履歴が残る

### REAL条件（投稿/返信共通）
- `provider_catalog(FACEBOOK)` が有効
- `provider_configurations.has_gui_config = true`
- `provider_configurations.connection_status = CONNECTED`
- `integrations.status = CONNECTED`

## （P2-04）受信箱のタグ/担当/SLA管理を有効化する手順
受信箱のワークフロー管理（タグ・担当者・期限・SLA）を使うには migration の適用が必要です。

### 手順1: migration適用
1. Supabaseの「SQL Editor」を開く
2. `supabase/migrations/202602060013_p2_inbox_advanced_workflow.sql` を貼り付けて実行
3. `Success. No rows returned` を確認する

### 手順2: GUIで動作確認
1. TEPPEN MEOで「統合受信箱」を開く
2. 任意メッセージを選び、ワークフロー管理で以下を入力
   - タグ（例: `要返信, クレーム`）
   - 担当者
   - 対応期限
3. 「ワークフローを保存」を押す
4. 続けて返信送信を実行する

期待結果:
- 保存後、一覧と詳細にタグ/担当/SLAが反映される
- 返信送信後、SLAが `COMPLETED` になる

### 失敗時の確認ポイント
- migration `202602060013` が未適用
- 店舗未選択（右上セレクタ未選択）
- 期限入力形式が不正（日時入力を再指定）

## （P2-05）テンプレ/ブランドキットを有効化する手順
投稿作成で「テンプレート適用」「NGワード警告」「推奨タグ補助」を使うには、migration適用が必要です。

### 手順1: migration適用
1. Supabaseの「SQL Editor」を開く
2. `supabase/migrations/202602060014_p2_template_brand_kit.sql` を貼り付けて実行
3. `Success. No rows returned` を確認する

### 手順2: ブランドキット保存（GUI）
1. TEPPEN MEOでADMINログイン
2. 「設定 → システム管理」を開く
3. 「ブランドキット」で以下を入力して「ブランドキットを保存」
   - トーンガイド
   - NGワード（カンマ/改行区切り）
   - 推奨ハッシュタグ（カンマ/改行区切り）
   - デフォルト署名

### 手順3: テンプレート作成（GUI）
1. 同画面の「投稿テンプレート」で、テンプレート名と本文を入力
2. 必要なら投稿先プラットフォーム（Instagram/Facebook/GBP/TikTok）を選択
3. 「テンプレートを作成」を押す

### 手順4: 投稿画面で動作確認
1. 「新規投稿作成」を開く
2. 「テンプレート適用」を押す
3. 推奨ハッシュタグをクリックして本文に追加されることを確認
4. NGワードを本文に入れて警告が表示されることを確認

期待結果:
- テンプレート本文 + 署名が本文へ反映される
- 推奨ハッシュタグ未使用/NGワード検知が表示される
- 投稿保存導線（承認申請/予約/下書き）が従来どおり動く

### 失敗時の確認ポイント
- migration `202602060014` が未適用
- 店舗未選択（右上セレクタ未選択）
- 組織に対する権限不足（ADMIN/MANAGER以外）
- 既存テンプレート名と重複（同一org内）

## （P3-01）順位キーワード管理を有効化する手順
「順位計測」画面でキーワードCRUDを使うには、migration適用が必要です。

### 手順1: migration適用
1. Supabaseの「SQL Editor」を開く
2. `supabase/migrations/202602060015_p3_rank_keyword_management.sql` を貼り付けて実行
3. `Success. No rows returned` を確認する

### 手順2: GUIで動作確認
1. TEPPEN MEOでログインする
2. 右上の店舗セレクタで対象店舗を選ぶ
3. 左メニューの「順位計測」を開く
4. 「キーワード追加」でキーワードを1件追加する（例: `渋谷 ラーメン`）
5. 一覧の「編集」で文言/メモを更新して保存する
6. 一覧の「削除」で削除する（論理削除）

期待結果:
- 追加/編集/削除が成功トースト付きで反映される
- 同じキーワード（大文字小文字差含む）は重複登録できない

### 失敗時の確認ポイント
- migration `202602060015` が未適用
- 店舗未選択（右上セレクタ未選択）
- rank trackerの公開状態が `HIDDEN/ADMIN_ONLY` になっている（`設定 → システム管理 → Feature Flag` で確認）

## よくある詰まりポイント
### A) 作成できない（支払い/制限が出る）
- 画面のメッセージをスクショして送ってください（こちらで状況に応じて案内します）

### B) どのキーを共有すればいいか分からない
- 共有するのは **Project URL** と **anon public key** の2つだけです
- `service_role key` は共有しないでください

### C) 値を貼り間違える
- 先頭/末尾の空白が混ざると動かないことがあります
- その場合は「もう一度コピーし直す」で解決することが多いです

### D) 「店舗未選択」と出るのに右上セレクタが見えない / 連携ボタンが押せない
これは多くの場合、フロント側のSupabase環境変数が未設定です（モック表示モード）。

確認と修正:
1. プロジェクト直下に `.env.local` を作成（既にあれば開く）
2. 以下を設定
   - `VITE_SUPABASE_URL=（Supabase Project URL）`
   - `VITE_SUPABASE_ANON_KEY=（Supabase anon key）`
3. 開発サーバーを再起動（`npm run dev` を止めて再実行）
4. 画面右上に店舗セレクタが表示されることを確認

補足:
- URLとanon keyの取得場所は `Project Settings -> API`
- ここに `service_role` は入れません（危険）

### E) 「Edge Function returned a non-2xx status code」が出る
`設定を保存` / `接続テスト` でこのエラーが出る場合は、以下を順番に実施してください。

#### 手順0: Functionコードを最新にして再Deployする（先に実施）
1. Supabase `Functions` を開く
2. 次の3関数を1つずつ開く
   - `admin-provider-secret-upsert`
   - `admin-provider-connection-test`
   - `admin-create-user`
3. リポジトリの対応ファイル `supabase/functions/<関数名>/index.ts` を丸ごと貼り替える
4. 各関数で `Save` → `Deploy` を実行する

補足:
- 2026-02-06 の修正で、`Authorization` のBearerトークン解析を厳密化しています。
- 旧コードのままだと、ログイン済みでも `401` になるケースがあります。
- フロント実装で `functions.invoke` に `Authorization` ヘッダを手動追加すると、`apikey` が欠落して `401` になるケースがあります（現在は修正済み）。

#### 手順0.5: Function設定の `Verify JWT` をOFFにする
`POST 401` かつ `Invocations.execution_id = null` の場合、Function本体に入る前にGatewayで拒否されています。  
このケースでは、以下3関数の `Verify JWT` をOFFにします（認証は関数内で実施）。

対象:
- `admin-provider-secret-upsert`
- `admin-provider-connection-test`
- `admin-create-user`

クリック手順:
1. Supabase `Functions` で対象関数を開く
2. `Details` タブを開く
3. `Verify JWT` を `OFF` に変更
4. `Save` する

#### 手順1: Phase0 migrationを適用する（最重要）
1. Supabase `SQL Editor` を開く
2. `supabase/migrations/202602060001_phase0_foundation.sql` を貼り付けて実行
3. `Success. No rows returned` になればOK

※このmigrationは `provider_catalog` / `provider_configurations` / `provider_secrets` / `feature_flags` などを揃えます。

#### 手順2: ADMIN所属を確認する
1. SQL Editorで以下を実行
   ```sql
   select m.org_id, m.user_id, p.email, m.role
   from public.memberships m
   left join public.profiles p on p.id = m.user_id
   order by m.created_at desc;
   ```
2. あなたのメール行で、対象orgの `role` が `ADMIN` になっているか確認

#### 手順3: もう一度GUI操作
1. TEPPEN MEOでいったん `ログアウト` して再ログイン（トークン更新）
2. `設定 -> SNS連携設定`
3. Providerを選択
4. `設定を保存` → `接続テスト`

#### それでも失敗する場合
- Supabase `Functions` で対象関数（`admin-provider-secret-upsert` / `admin-provider-connection-test`）のLogsを開く
- エラー本文をスクショで送ってください（ここまで出れば原因を特定できます）
- `Invocations` で `status=401` が続く場合は、まず「手順0の再Deploy漏れ」を疑ってください
- `Invocations` で **`execution_id = null` の POST 401** が続く場合は、Function本体に入る前のGateway拒否です（ヘッダ不整合の可能性）。この場合はフロントを最新化し、`apikey` + `Authorization` を明示送信する実装へ更新済みか確認してください。
