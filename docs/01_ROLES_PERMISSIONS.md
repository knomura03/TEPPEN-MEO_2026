# TEPPEN MEO：ロール/権限設計（権限フラグ方式）

最終更新: 2026-02-14

## 目的
ロール（ADMIN/SUPERVISOR/MANAGER/USER）の呼び名や範囲が将来変わっても、実装や運用が壊れないようにします。

そのために、**ロール名ではなく「権限フラグ」で機能アクセスを制御**します。

## ロール定義（確定: 2026-02-09）
ロールは4段階に整理しました（内部と顧客を明確に分離します）。

- **ADMIN**: 内部。全権（全グループ/全店舗/全設定/全ログ/全ユーザー作成）。
- **SUPERVISOR**: 内部。販売代理店（旧MANAGERの置換）。顧客グループの管理（契約プラン割当、顧客ユーザー招待、上限管理など）。
- **MANAGER**: 顧客。グループ内リーダー（店舗責任者）。顧客ユーザー管理（USER招待）や承認などの運用権限。
- **USER**: 顧客。一般ユーザー（店舗スタッフ）。基本機能（投稿/受信箱/設定など）。

補足:
- **旧`MANAGER`（代理店）= 新`SUPERVISOR`**へ移行する前提（DB migrationで置換）。
- 新`MANAGER`は「顧客側のグループ内リーダー」として新規に作成していく。

## 基本方針（重要）
1. **表示制御（フロント）**: 画面・ボタンは権限に応じて表示/非活性にする（UX）。
2. **拒否（DB/サーバー）**: 権限のない操作はDB（RLS）やサーバー（Edge Functions）で必ず拒否する（セキュリティ）。

フロントで隠してもAPIを叩けば操作できる、という状態はNGです。

## 権限フラグ一覧（例）
最低限、以下のようなフラグを想定します（名称は実装で確定）。

### 運用/管理
- `canManageUsers`：ユーザー作成/編集/削除、招待、権限変更
- `canSendMail`：メルマガ配信・配信リスト管理
- `canManageIntegrations`：外部連携（GBP等）の接続/解除、再同期
- `canViewAuditLogs`：監査ログ閲覧
- `canManageBillingPlans`：契約プラン（Plan catalog）の作成/更新/有効化
- `canSetStorePlan`：店舗への契約プラン割当/変更（`store_subscriptions`）
- `canManageUserStoreControls`：ユーザー別 店舗上限/CSV一括ON-OFF（`user_store_controls`）
- `canManageSystemSettings`：システム設定（将来: GUIで鍵管理等）
- `canManageGroups`：グループ作成/名称変更（Settings > グループ）

### 日常機能
- `canCreatePosts`：投稿作成/編集/削除
- `canSchedulePosts`：予約投稿
- `canUploadMedia`：画像/動画アップロード
- `canUseAiAssistant`：AI生成（Gemini等）
- `canUseInbox`：受信箱閲覧
- `canReplyInbox`：返信（GBP口コミ返信など）
- `canEditStoreProfile`：店舗情報（NAP等）編集

## ロールと権限の関係（運用ルール）
- まずは「ロールにプリセットの権限セット」を割り当てる（例: MANAGERは `canManageUsers=true`）。
- ただし将来の仕様変更に備え、**個別ユーザー（Membership）単位での上書き**を許可する。
- 変更履歴（誰が、いつ、何を変えたか）は監査ログに残す。

## 実装で固定した重要ルール（2026-02-09）
- **内部ユーザーの定義**: `ADMIN` / `SUPERVISOR`
- **顧客ユーザーの定義**: `MANAGER` / `USER`
- **FeatureFlagの`ADMIN_ONLY`**: 内部のみ（`ADMIN`/`SUPERVISOR`）
- **契約プラン割当（請求は外部運用）**
  - プラン割当単位は店舗（`store_subscriptions`）
  - 内部（`ADMIN`/`SUPERVISOR`）が店舗付きで顧客ユーザー（`MANAGER`/`USER`）を作成する場合、`planCode`を指定すると店舗プランを即時反映できる
  - 顧客`MANAGER`がユーザー招待する場合は、`planCode`は無視する（顧客がプランを触れない運用を保証）

運用手順は `docs/15_CONTRACT_PLAN_OPERATIONS.md` を参照。

## “二段構え”の具体例
### 例1: ユーザー管理
- フロント: USERには「ユーザー・契約管理」メニューを出さない
- DB/RLS: USERは `memberships` や `users` 管理系テーブルに対して更新/削除できない

### 例2: GBP連携
- フロント: 「接続する」ボタンは権限がある人だけ表示
- サーバー: OAuth開始/コールバック/トークン保存はEdge Functionsで実施し、クライアントにシークレットを渡さない

## GUIでの権限変更（理想要件）
knomuraの工数を最小にするため、最終的には以下を管理画面（GUI）で完結させます。
- ユーザー一覧 → 権限フラグのON/OFF
- 上限（数値）の変更（例: 機能枠、作成可能数）
- 変更は監査ログに自動記録

※MVPでは「安全運用」を優先し、秘密情報の登録は環境変数運用になる可能性があります（`docs/04_ENV_AND_SECRETS.md`）。

## 関連ドキュメント
- `/Users/nomurakatsuya/.codex/worktrees/b98f/TEPPEN-MEO_2026/docs/22_ROLE_ACCESS_MATRIX.md`（UI表示/操作/API/RLSを1枚で確認）
- `/Users/nomurakatsuya/.codex/worktrees/b98f/TEPPEN-MEO_2026/docs/19_USER_CRUD_RUNBOOK.md`（招待/編集/削除の実運用手順）
- `/Users/nomurakatsuya/.codex/worktrees/b98f/TEPPEN-MEO_2026/docs/26_MANAGEMENT_UNIT_OPERATIONS.md`（ADMIN向け: 管理ユニット運用手順）
- `/Users/nomurakatsuya/.codex/worktrees/b98f/TEPPEN-MEO_2026/docs/27_USER_PROVISIONING_RULES.md`（新規作成/既存追加ルール）
