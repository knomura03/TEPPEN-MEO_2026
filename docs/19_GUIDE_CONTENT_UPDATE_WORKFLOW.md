# ガイド文言更新フロー（skills化の土台）

## 目的
- ガイド文言をコードから分離し、非エンジニアでも更新しやすい形にする
- ガイドの表示順を **「今いるページのメイン → サイドバー」** で固定する
- 将来、ガイド更新を専用Skillで自動化するための前提を整える

## 現在の構成
- ガイド定義ファイル: `components/guides/tourSteps.json`
- 画面組み立てロジック: `components/guides/tourSteps.ts`
- 表示コンポーネント: `components/OnboardingTour.tsx`
- 定義チェック: `npm run guides:validate`

## 更新手順（最短）
1. `components/guides/tourSteps.json` を編集する
2. `npm run guides:validate` を実行する
3. `npm run typecheck` を実行する
4. `npm run build` を実行する
5. 画面上でガイドを開き、表示順が **ページ→サイドバー** になっていることを確認する
6. `git add -A && git commit && git push`

## JSON編集ルール
- `pageSummaryByView`: 画面ごとの要約（必須、空文字不可）
- `pageStepsByView`: 画面ごとのステップ配列（各画面1件以上）
- `sidebarSteps`: サイドバー共通ステップ（1件以上）
- 各ステップの必須項目: `title`, `content`
- `position` の許可値: `top`, `bottom`, `left`, `right`, `center`

## 追加時の注意点
- 新しい画面を追加した場合は、以下3点を必ず同時更新する
  - `components/guides/tourSteps.json`
  - `scripts/guides/validateTourSteps.ts` の `VIEW_STATES`
  - 画面側のターゲット要素ID（`data-testid`/`id`）

## 将来のskills化方針
- 目標: 「ガイド文言の草案生成 → JSON反映 → バリデーション → PR作成」を1コマンド化
- Skillの入力: `画面名`, `目的`, `禁止表現`, `トーン`
- Skillの出力: 更新済み `tourSteps.json` と差分サマリ
- 本ファイルは、そのSkillが参照する運用ルールの一次情報として使う
