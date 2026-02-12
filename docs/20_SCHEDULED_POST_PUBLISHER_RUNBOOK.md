# 予約投稿の自動実行（毎分）設定手順

最終更新: 2026-02-12  
対象: Supabase Production `odjlnwfrqckekrdicnaa`

---

## 1. 目的
- 予約投稿（`status=SCHEDULED`）を、指定時刻到達後に自動投稿するための定期実行を有効化します。
- この設定は **最初の1回だけ** です。以降は自動で動きます。

---

## 2. 事前確認（30秒）
1. TEPPEN側で、少なくとも1件の予約投稿が作成できる状態にする
2. Supabaseで以下のFunctionが `ACTIVE` になっていることを確認
   - `scheduled-post-publisher`
   - `post-publish-run`

---

## 3. Supabase Dashboardでの設定（1回だけ）
1. [Supabase Dashboard](https://supabase.com/dashboard) を開く
2. プロジェクト `odjlnwfrqckekrdicnaa` を選ぶ
3. 左メニュー `Edge Functions` を開く
4. `scheduled-post-publisher` を開く
5. `Schedules` タブを開く
6. `Create schedule`（または `New schedule`）を押す
7. 以下を設定
   - Name: `scheduled-post-publisher-every-minute`
   - Cron: `* * * * *`（毎分）
   - Method: `POST`
   - Body: `{}`（空でも可）
8. 保存（Create）

> もし `Header` 入力欄が表示され、将来 `SCHEDULED_POST_PUBLISHER_SECRET` を設定した場合は  
> `x-cron-secret: <設定した値>` を追加してください。  
> 現在はSecret未設定でも動作する実装です。

---

## 4. 動作確認（失敗しない最短手順）
1. TEPPENで「1〜2分後」の予約投稿を1件作成
2. 2分待つ
3. 投稿一覧で対象投稿の状態が `公開済み` または `失敗` に変わることを確認
4. 必要なら Supabase SQL Editor で以下を実行し、実行ログを確認

```sql
select created_at, action, payload
from public.audit_logs
where action = 'SCHEDULED_POST_PUBLISHER_RUN'
order by created_at desc
limit 20;
```

---

## 5. うまく動かないときの確認ポイント
1. `scheduled-post-publisher` が `ACTIVE` か
2. `Schedules` が `Paused` になっていないか
3. 対象投稿が以下条件を満たしているか
   - `status = 'SCHEDULED'`
   - `approval_status = 'APPROVED'`
   - `scheduled_at <= now()`
4. OAuth接続が有効か（設定 > SNS連携設定で接続テスト成功か）

---

## 6. 補足
- 実行タイミングは「毎分」なので、予約時刻ちょうどではなく最大約1分の遅延があります。
- 1つでも配信失敗があると `posts.status` は `FAILED` になり、詳細は `post_publish_logs` に記録されます。
