# knomura向け：GitHub初期セットアップ手順（間違いない版）

最終更新: 2026-02-04

## この手順書の目的
このプロジェクト（TEPPEN MEO）を **GitHub上に置いて**、変更履歴とレビューを安全に回せる状態にします。

> 途中で不安になったら、**その画面のスクショ**と、**どこで止まったか**を送ってください。こちらで確実に案内します。

## 前提
- このPCで、すでにこのフォルダを開けている状態  
  `TEPPEN-MEO_2026`
- ターミナル（黒い画面）を開ける状態

## 0) まず確認（1分）
ターミナルで以下を1行ずつ実行します。

```bash
cd /Users/nomurakatsuya/Desktop/CYDER/studio/TEPPEN-MEO_2026
git status -sb
```

何かエラーが出たら、その画面をスクショして送ってください。

## 1) GitHub上にリポジトリを作る（クリック順）
1. ブラウザで GitHub を開く
2. 右上の「+」を押す
3. 「New repository」を押す
4. Repository name に `TEPPEN-MEO_2026` を入力
5. Visibility は **Private** を選ぶ（原則ここはPrivate推奨）
6. **Initialize this repository** のチェックは全部OFF（README等は作らない）
7. 「Create repository」を押す

作成後に表示される画面で、**https のURL** が見えます（例：`https://github.com/<owner>/TEPPEN-MEO_2026.git`）。
そのURLをこちらに貼ってください（私が残りをターミナルで進めます）。

## 2) （必要な場合のみ）GitHubにログイン状態を作る
私が `git push` を実行するために、PCがGitHubにログインできている必要があります。
もし push 時に「ログインが必要」な画面が出たら、次のどちらかで進めます。

### A案（おすすめ）：GitHub CLI（gh）でログイン
ターミナルで以下を実行します。

```bash
gh auth login
```

表示された質問には、基本的に次を選べばOKです。
- GitHub.com
- HTTPS
- Browserでログイン（おすすめ）

途中でブラウザが開いて「Authorize」などが出たら許可します。

### B案（うまくいかない時）：GitHub Desktopを使う
GitHub Desktopが入っている場合、GUIでpushできます。
（この案が必要になったら、こちらから手順を分岐して案内します）

## 3) リモート設定とpush（こちらで実施）
GitHubリポジトリのURLが分かり次第、こちらで以下を実施します。
- `git remote add origin ...`
- `git push -u origin main`
- `git push -u origin codex/m0-supabase-foundation`
- PR作成（MVP作業の履歴がGitHubに残る状態へ）

