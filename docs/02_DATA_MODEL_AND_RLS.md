# TEPPEN MEO：データモデル & RLS方針（MVP）

最終更新: 2026-02-03

## 目的
モック脱却を最短で進めるために、MVPで必要なテーブルとRLS（行レベルセキュリティ）の方針を先に固定し、後戻り（作り直し）を防ぎます。

## テナントモデル（用語）
- **Organization（組織）**: 代理店/ブランド/チェーンなど、契約の単位
- **Store（店舗）**: 実店舗（MEO運用の単位、GBPロケーションに紐付く）
- **Membership（所属）**: ユーザーがどの組織/店舗に属するか + ロール/権限フラグ

### MVPの基本ルール（決定）
- データの基本スコープは **Store**（店舗）です。
- 同じOrganization配下に複数Storeがあり得ます。
- Membershipは「Store単位」または「Organization単位（全店舗）」のどちらかを表現できる形にします。
  - `store_id` が入っていれば **店舗スコープ**
  - `store_id` がNULLなら **組織スコープ（配下の全店舗）**

※将来、1ユーザーが複数店舗に属するケースが増えた場合は `membership_stores` のような中間テーブルで拡張します。

## 主要テーブル（MVP）
以下は“最小”の想定です（詳細カラムは実装で確定）。

### 基本
- `profiles`
  - Supabase Authのユーザー（`auth.users`）に紐づくアプリ側プロフィール
- `organizations`
  - `id`, `name`, `created_at`
- `stores`
  - `id`, `org_id`, `name`, `address`, `phone`, `category`, `business_hours`, `created_at`
- `memberships`
  - `id`, `user_id`, `org_id`, `store_id`(nullable), `role`, `permissions`(jsonb), `created_at`

### 投稿
- `posts`
  - `id`, `store_id`, `author_user_id`, `content`, `status`, `platforms`(array), `scheduled_at`, `published_at`, `created_at`, `updated_at`
- `post_media`
  - `id`, `post_id`, `store_id`, `storage_path`, `mime`, `size`, `created_at`

### 連携（GBP）
- `integrations`
  - `id`, `store_id`, `provider`(例: `GBP`), `status`, `last_sync_at`, `last_error`, `created_at`, `updated_at`
- `gbp_locations`
  - `id`, `store_id`, `location_id`（GBP側のID）, `created_at`

※OAuthトークン等の資格情報は、クライアントから絶対に読めない場所に保存します（例: `integration_credentials` を作り、RLSで完全拒否 + Edge Functionsのみ参照）。

### 受信箱（まずはGBP口コミ）
- `inbox_threads`
  - `id`, `store_id`, `provider`, `external_thread_id`, `status`, `last_message_at`, `created_at`
- `inbox_messages`
  - `id`, `thread_id`, `store_id`, `provider`, `external_message_id`, `sender`, `content`, `received_at`, `is_replied`, `reply_content`, `reply_sent_at`

### 監査ログ
- `audit_logs`
  - `id`, `org_id`, `store_id`, `actor_user_id`, `action`, `target_type`, `target_id`, `payload`(jsonb), `created_at`

## RLS（行レベルセキュリティ）方針
### 原則
1. **Storeスコープ外のデータは見えない/触れない**（最重要）
2. OrganizationスコープのMembershipを持つユーザーは、そのOrg配下のStoreにアクセスできる
3. Platform ADMIN（knomura）は例外的に全件アクセス可能（ただしログを残す）
4. Edge Functions（サービスロール）は必要最小限の範囲で実行し、監査ログに残す

### “例外”はポリシーで明文化
曖昧にしないため、例外はドキュメントとポリシーに明記します。
- 例: `is_platform_admin()` が true の場合は read/write を許可

## 監査ログ（最低要件）
最低限、以下は必ず残します。
- 誰が（actor_user）
- いつ（created_at）
- 何をしたか（action）
- 何に対して（target_type/target_id）
- どの店舗/組織か（store_id/org_id）
- 追加情報（payload：変更前後の要点、エラー理由など）

## 関連ドキュメント
- `docs/00_MVP_DEFINITION.md`
- `docs/01_ROLES_PERMISSIONS.md`
- `docs/03_INTEGRATION_GBP.md`

