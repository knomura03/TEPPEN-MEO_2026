# knomura向け手順書（最小作業で進める）

最終更新: 2026-02-03

## この手順書の読み方
- 「どこをクリックするか」をそのまま書いています。
- 途中で不安になったら、**その画面のスクショ**と、**どこで止まったか**を送ってください。こちらで切り分けます。
- 用語が分からなくても大丈夫です（無理に理解しなくてOK）。

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

## （重要）最初の「店舗が未設定」を解消する（初期データの作成）
SupabaseでRLS（アクセス制御）を有効にすると、最初は「所属（membership）が無いユーザー」は店舗が見えません。
そのため、**最初の1回だけ** SupabaseのSQL Editorで `supabase/bootstrap.sql` を実行します。

### 手順（クリック順）
1. TEPPEN MEOにメールでログインする（先にユーザーが作成される必要があります）
2. Supabaseのダッシュボードに戻る
3. 左メニューの「SQL Editor」を押す
4. 新しいクエリを開く
5. ローカルのリポジトリにある `supabase/bootstrap.sql` を開いて、全部コピーして貼り付ける
6. `YOUR_EMAIL_HERE` を、さきほどログインしたメールアドレスに置き換える
7. 「Run（実行）」を押す
8. TEPPEN MEOに戻って、画面上部の「店舗一覧を再読み込み」を押す
9. もし「ユーザー・契約管理」などの権限が反映されない場合は、ブラウザの再読み込み（リロード）を1回する
10. それでも「店舗が未設定」の表示が消えない場合は、`supabase/rls.sql` を再実行する

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

## よくある詰まりポイント
### A) 作成できない（支払い/制限が出る）
- 画面のメッセージをスクショして送ってください（こちらで状況に応じて案内します）

### B) どのキーを共有すればいいか分からない
- 共有するのは **Project URL** と **anon public key** の2つだけです
- `service_role key` は共有しないでください

### C) 値を貼り間違える
- 先頭/末尾の空白が混ざると動かないことがあります
- その場合は「もう一度コピーし直す」で解決することが多いです
