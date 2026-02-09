# 契約プラン運用手順（GUI）

最終更新: 2026-02-09

## 目的
TEPPEN MEO内で「契約プランの作成/更新」「ORGへの割当」「ユーザー招待時のプラン未設定事故の防止」をGUIで完結させます。

重要:
- **請求/決済は当面システム外（外部運用）**です。本書は「社内運用の管理情報」を整えるための手順です。
- 操作できるのは **内部ユーザー（`ADMIN` / `SUPERVISOR`）** だけです。

## 用語
- **ORG**: 店舗（Store）が所属する組織単位。右上の店舗セレクタで選んだ店舗から、対象ORGが決まります。
- **契約プラン（Billing Plan）**: `billing_plans` に保存されるプラン定義（例: `FREE`, `STANDARD`）。
- **ORGの契約プラン割当**: `org_subscriptions` に保存される「このORGはどのプランか」という設定です。

## 事前条件（チェックリスト）
1. 右上の店舗セレクタで、対象店舗を選択できること（店舗未選択だとORGが確定できません）
2. Supabase設定が入っていること（`.env.local` に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`）
3. DB migrationが適用済みであること
   - `supabase/migrations/202602060020_p4_billing_pwa_foundation.sql`（課金DB基盤）
   - `supabase/migrations/202602090001_p4_roles_supervisor_and_plan_admin_gui.sql`（SUPERVISOR/プラン運用）
4. Edge Functionsが配備済みであること
   - `admin-billing-plan-upsert`
   - `admin-org-subscription-set-plan`
   - `admin-create-user`（ユーザー招待）

## 準備: DB migration 適用手順（Supabase SQL Editor）
前提: 本番Supabaseの `SQL Editor` で実行します（forward-only）。

1. Supabaseダッシュボードを開く
2. 左メニュー `SQL Editor` を開く
3. `New query`（新規クエリ）を作成
4. 下記ファイルの内容を、丸ごと貼り付けて `Run` する
   - `supabase/migrations/202602060020_p4_billing_pwa_foundation.sql`
   - `supabase/migrations/202602090001_p4_roles_supervisor_and_plan_admin_gui.sql`
5. 画面下に `Success. No rows returned` が出ることを確認

注意:
- 途中でエラーになった場合は、エラーメッセージ（全文）を貼ってください。前提migrationの抜け/実行順の問題を切り分けます。

## 準備: Edge Functions デプロイ手順（Supabase GUI）
前提: 既存運用に合わせて `Verify JWT=OFF` で運用します。

### 1) `admin-billing-plan-upsert` をデプロイ
1. Supabaseダッシュボードを開く
2. 左メニュー `Edge Functions` → `Functions`
3. 右上 `Deploy a new function` → `Via Editor`
4. Function name に `admin-billing-plan-upsert` を入力して作成
5. エディタに、下記ファイルの中身を丸ごと貼り付けて `Deploy`（または保存/デプロイ）
   - `supabase/functions/admin-billing-plan-upsert/index.ts`
6. デプロイ後、Functions一覧に表示されることを確認
7. Function詳細の設定で `Verify JWT` を `OFF` にする

### 2) `admin-org-subscription-set-plan` をデプロイ
同様に、以下をデプロイします。
- Function name: `admin-org-subscription-set-plan`
- 貼り付け元: `supabase/functions/admin-org-subscription-set-plan/index.ts`

### 3) Secrets確認（共通）
1. 左メニュー `Edge Functions` → `Secrets`
2. `SUPABASE_SERVICE_ROLE_KEY` が存在することを確認
   - 無い場合: Supabaseの `Project Settings` から `service_role` キーを取得し、Secretsへ登録


## 手順1: 契約プランを作成/更新する（内部ユーザーのみ）
1. 左メニューから `課金・請求` を開く
2. 画面内の `内部: 契約プラン管理` セクションを確認
3. `プラン作成/更新` に入力
   - `code`: 例 `FREE`（英大文字/数字/アンダースコア）
   - `name`: 例 `Free`
   - `amountMonthly`: 例 `0`（月額）
   - `currency`: 当面 `JPY`
   - `有効`: チェックON（inactiveはORG割当できません）
   - `description`: 任意
4. `保存` を押す
5. 左の `プラン一覧` に作成したプランが出ることを確認

補足:
- 既存プランを更新する場合は `プラン一覧` から対象をクリックして編集状態にしてから `保存` します。

## 手順2: ORGに契約プランを割り当てる（内部ユーザーのみ）
1. 右上の店舗セレクタで、対象ORGに属する店舗を選択する
2. 左メニュー `課金・請求` を開く
3. `ORGへのプラン割当` でプランを選び、`このORGに割当` を押す
4. 表示が `現在: <planCode>` に変わることを確認
5. 下の `直近の操作履歴` に `ORG_SUBSCRIPTION_SET_PLAN` が出ることを確認（証跡）

## 手順3: 新規ユーザー招待（planCode必須ルール）
内部ユーザー（`ADMIN`/`SUPERVISOR`）が「そのORGで最初の顧客ユーザー（`MANAGER`/`USER`）を作る」時だけ、`planCode` が必須になります。

### 3-A: ORGにプラン未設定のまま招待しようとした場合（推奨しない）
1. 左メニュー `ユーザー・契約管理` を開く
2. `新規ユーザー作成（招待）` を開く
3. `権限ロール` で `MANAGER` または `USER` を選ぶ
4. 画面内に「このORGは契約プラン未設定です（planCode必須）」が表示される
5. `契約プラン（planCode）` を選択してから招待する

### 3-B: 推奨フロー（先に手順2でORGへ割当してから招待）
1. 先に「手順2」で対象ORGへプランを割り当てる
2. 左メニュー `ユーザー・契約管理` を開く
3. `新規ユーザー作成（招待）` を開く
4. `現在の契約プラン: <planCode>` が表示され、招待モーダル内にプラン選択欄が出ないことを確認
5. `名前` / `メールアドレス` を入力して招待する

補足:
- 顧客`MANAGER`が `USER` を招待する場合、`planCode` は触れません（運用事故防止）。

## よくあるエラーと対処
- `プラン一覧` が空で「migration未適用の可能性」表示
  - `202602060020` が未適用の可能性が高いです（Supabase SQL Editorで適用状況を確認）
- `403 Not allowed` / `Only ADMIN/SUPERVISOR ...`
  - ログインユーザーが内部ロールではありません（`ADMIN`/`SUPERVISOR`でログインしてください）
- `401` 系（Edge Function）
  - ログアウト→再ログインを試す
  - Functions配備/Secrets（`SUPABASE_SERVICE_ROLE_KEY`）を確認する
  - それでも解消しない場合は `docs/13_SYSTEM_SURFACE_STATUS_MATRIX.md` の「Gateway 401対策」メモに従い、Function設定（`Verify JWT`）やInvocationsを確認する
