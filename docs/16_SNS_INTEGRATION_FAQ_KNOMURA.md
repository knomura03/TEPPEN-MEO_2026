# SNS実API連携 FAQ（knomura向け）

最終更新: 2026-02-10
対象: Google Business Profile / Facebook / Instagram

## 1. 基本

### Q1. 「私のアカウントでAPIを利用すれば、他企業も使えるようになるのはなぜ？」
A. 正確には「あなた個人のSNSアカウントを全社で共有する」のではありません。  
TEPPEN側は店舗ごとにOAuthトークンを分離保存します。各社は自社のGoogle/Metaアカウントで個別に認可し、自社トークンだけが使われます。

### Q2. 他社の情報が見える/投稿できる事故は起きませんか？
A. 起きない設計にします。  
トークンは `store_id` + `provider_key` 単位で分離し、RLS（行レベル権限）で別組織データへアクセスできないよう制御します。

### Q3. 代理店（SUPERVISOR）が顧客SNSを触れる理由は？
A. 運用代行を前提にしているためです。  
ただし接続権限はロールで制御でき、必要なら特定組織でSUPERVISORの権限を外せます（別途運用ポリシーで固定）。

## 2. セキュリティ

### Q4. `access_token` / `refresh_token` はどこに保存されますか？
A. Supabaseの `integration_credentials` テーブルに保存し、平文ではなく AES-GCM で暗号化します。  
復号に使う鍵は Edge Function の Secret（`PROVIDER_CONFIG_ENCRYPTION_KEY`）で管理します。

### Q5. トークンが失効したらどうなりますか？
A. 接続テストが `ERROR` になり、再接続が必要になります。  
Googleは refresh token がある場合は自動更新できますが、権限剥奪・長期未使用時は再認可が必要です。

### Q6. なぜ接続テストだけで投稿テストしないのですか？
A. 誤投稿防止のためです。  
最初は read-only API（アカウント一覧や権限確認）のみで疎通確認し、投稿権限の本番検証は別ゲートに分けます。

## 3. 運用・審査

### Q7. Meta/Googleの審査はいつ必要ですか？
A. 内部運用のみなら最小構成で始められます。  
外部公開や未所属ユーザーへの広範囲利用を行う段階で、App Review / Verification の対応が必要になります。

### Q8. 1つのGoogle/Metaアプリを複数顧客で使って大丈夫？
A. 技術的には可能です。  
ただし利用規約・審査条件・障害影響範囲を考えると、将来的には「環境/事業単位でアプリ分割」を推奨します。

### Q9. 顧客のパスワード共有は必要ですか？
A. 不要です。  
必要なのは Google Cloud / Meta Developer で発行した `client_id` / `client_secret` で、認可は顧客自身のログインで行います。

## 4. トラブル時

### Q10. `Invalid JWT / 401` が出る場合の最短確認は？
A. 以下を順に確認します。  
1. `.env.local` の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` が正しい  
2. 再ログイン済み（トークン更新）  
3. Edge Function が最新デプロイ済み（`Verify JWT=OFF` 前提の関数含む）  
4. フロント呼び出しが `?client=direct-http-v3` 経由になっている

### Q11. OAuth後に画面が戻らない場合は？
A. `OAUTH_DEFAULT_RETURNTO` と `OAUTH_RETURNTO_ALLOWLIST` の設定不一致が典型です。  
Return URL の origin が allowlist に入っているか確認します。

### Q12. Instagramだけ失敗する場合は？
A. `instagram_user_id` 未設定、または Page と IGビジネスアカウントの紐付け不足が多いです。  
Meta側の連携状態を先に確認してください。
