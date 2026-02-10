# 実SNS API接続ランブック（GBP / Facebook / Instagram）

最終更新: 2026-02-10  
対象環境: Supabase Production `odjlnwfrqckekrdicnaa`

---

## 0. この手順でできること
- MOCKではなく実OAuthで接続する
- 認可コード貼り付けは不要（認可→コールバックで自動完了）
- 接続テストで `CONNECTED / ERROR` を実APIで判定する

---

## 1. 先に準備するもの（手元）
- TEPPENログイン可能な内部アカウント（`ADMIN` または `SUPERVISOR`）
- Google Cloud の `client_id` / `client_secret`（GBP用）
- Meta Developers の `app_id` / `app_secret`（Facebook/Instagram用）

注意:
- パスワード共有は不要
- `client_secret` はTEPPENへ入力後、再表示できません（仕様）

---

## 2. 外部コンソール設定

### 2-1. Google Cloud（GBP）
1. Google Cloudで対象プロジェクトを開く
2. OAuth 2.0 Client（Webアプリ）を作成または選択
3. Redirect URI に以下を登録  
`https://odjlnwfrqckekrdicnaa.supabase.co/functions/v1/oauth-callback`
4. `client_id` / `client_secret` を控える

### 2-2. Meta Developers（Facebook / Instagram）
1. Meta App を作成または選択
2. Facebook Login 設定で Redirect URI に以下を登録  
`https://odjlnwfrqckekrdicnaa.supabase.co/functions/v1/oauth-callback`
3. `app_id` / `app_secret` を控える
4. Instagramを使う場合は、Facebook Page と Instagramビジネスアカウントを紐付ける

---

## 3. TEPPEN側設定（GUI）

### 3-1. Provider設定保存
1. `設定 > SNS連携設定` を開く
2. 右下 `Provider設定（Admin）` で対象providerを選ぶ
3. 設定JSON（またはフォーム）に必要IDを入力
   - Facebook: `facebook_page_id`
   - Instagram: `instagram_user_id`
   - GBP: 必要に応じて `gbp_account_id` / `gbp_location_id`
4. シークレット欄に `client_secret`（Metaは`app_secret`）を入力
5. `設定を保存` を押す

### 3-2. OAuth接続
1. Providerカードの `連携する` を押す
2. OAuthモーダルの `認可画面を開く` を押す
3. Google/Metaの認可画面で許可
4. 自動でTEPPENへ戻る（`Settings > SNS連携設定`）

### 3-3. 接続テスト
1. 対象providerを選択
2. `接続テスト` を押す
3. `CONNECTED` になることを確認

---

## 4. 正常判定
- UIトーストで接続成功が出る
- Providerカードの `connection: CONNECTED`
- `接続テスト` が成功（実API read-only）

---

## 5. 失敗時の確認（最短）

### 5-1. `401 / Invalid JWT`
1. 再ログイン
2. `.env.local` の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を確認
3. フロントが `?client=direct-http-v3` 呼び出しになっているか確認

### 5-2. OAuth後に戻らない
1. Supabase Function Secretsの `OAUTH_DEFAULT_RETURNTO` を確認
2. `OAUTH_RETURNTO_ALLOWLIST` に `http://localhost:3000`（ローカル）または本番URLが含まれるか確認

### 5-3. Instagramだけ失敗
1. `instagram_user_id` が保存されているか確認
2. Meta側で Page と IGビジネスアカウントが紐付いているか確認

### 5-4. GBPだけ失敗
1. Google API有効化漏れがないか確認
2. OAuth同意画面の設定（テストユーザー/スコープ）を確認

---

## 6. 運用ルール（推奨）
- まず read-only 接続テストのみ実施
- 投稿/返信の本番検証は別日に分ける
- トークン失効時は再接続で復旧し、復旧記録を `docs/14_PHASE_AUDIT_LOG.md` に残す
