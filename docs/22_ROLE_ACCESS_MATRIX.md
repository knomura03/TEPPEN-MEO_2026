# ロール別アクセスマトリクス v3.1（管理ユニット対応）

最終更新: 2026-02-15

## 前提
- ロール階層: `ADMIN > SUPERVISOR > MANAGER > USER`
- データ構造: `1グループ(organizations) : N店舗(stores)`、`1店舗 : Nユーザー`
- 新規ユーザー作成時は **グループ必須 + 店舗必須**
- 既存メールアドレスで新規招待は不可（固定エラー）
- SUPERVISORの管理範囲は「管理ユニット」境界で制限

## 1) 画面表示（ナビ）権限
| 画面 | ADMIN | SUPERVISOR | MANAGER | USER |
|---|---:|---:|---:|---:|
| ダッシュボード / 投稿 / カレンダー / 受信箱 / アンケート / 順位チェック | ✅ | ✅ | ✅ | ✅ |
| ユーザー管理 | ✅ | ✅（自管理ユニット内） | ✅（自グループ内） | ❌ |
| グループ管理 | ✅ | ✅（自管理ユニット内） | ✅（自グループのみ） | ❌ |
| 契約プラン | ✅ | ✅（自管理ユニット内） | 閲覧のみ | 閲覧のみ |
| 設定 > システム管理 | ✅ | ✅（内部向け設定のみ） | ❌ | ❌ |
| 設定 > 管理ユニット管理 | ✅のみ | ❌ | ❌ | ❌ |

## 2) ユーザー作成・追加・編集
| 操作 | ADMIN | SUPERVISOR | MANAGER | USER |
|---|---:|---:|---:|---:|
| 新規ユーザー作成（招待） | ✅ 全ロール | ✅ MANAGER/USER | ✅ USERのみ | ❌ |
| 作成時にグループ/店舗必須 | ✅ | ✅ | ✅ | - |
| 既存メールで新規招待 | ❌（固定400） | ❌（固定400） | ❌（固定400） | - |
| 既存ユーザー追加（2店舗目/2グループ目） | ✅ | ✅（同一管理ユニット内） | ✅（自グループのUSERのみ） | ❌ |
| ユーザー編集（名前/店舗/ロール） | ✅ | ✅（同一管理ユニット内の下位ロール） | ✅（自グループUSERの店舗割当） | ❌ |
| 組織から外す | ✅ | ✅（同一管理ユニット内） | ✅（自グループUSERのみ） | ❌ |
| 完全削除（Auth削除） | ✅のみ | ❌ | ❌ | ❌ |

## 3) グループ管理
| 操作 | ADMIN | SUPERVISOR | MANAGER | USER |
|---|---:|---:|---:|---:|
| グループ作成（初期店舗同時作成） | ✅ | ✅（自管理ユニット配下） | ❌ | ❌ |
| グループ名変更 | ✅ | ✅（自管理ユニット配下） | ✅（自グループのみ） | ❌ |
| グループの管理ユニット変更 | ✅のみ | ❌ | ❌ | ❌ |

## 4) 契約プラン（店舗単位）
| 操作 | ADMIN | SUPERVISOR | MANAGER | USER |
|---|---:|---:|---:|---:|
| プランカタログ作成/更新/削除 | ✅ | ✅ | ❌ | ❌ |
| 店舗プラン即時切替 | ✅ | ✅（自管理ユニット内） | ❌ | ❌ |
| 店舗プラン予約切替 | ✅ | ✅（自管理ユニット内） | ❌ | ❌ |
| 店舗プラン閲覧 | ✅ | ✅ | ✅ | ✅ |

## 5) 管理ユニット（内部概念）
| 操作 | ADMIN | SUPERVISOR | MANAGER | USER |
|---|---:|---:|---:|---:|
| 管理ユニット作成/名称変更 | ✅のみ | ❌ | ❌ | ❌ |
| SUPERVISOR割当/付替 | ✅のみ | ❌ | ❌ | ❌ |
| 管理ユニット一覧の閲覧 | ✅のみ | ❌ | ❌ | ❌ |

## 6) 主要APIの権限制御（最終拒否ポイント）
| Function | 許可ロール（要旨） |
|---|---|
| `admin-create-user` | `orgId/storeId` 必須。ADMIN:全ロール / SUPERVISOR:MANAGER・USER / MANAGER:USER |
| `admin-auth-link` | INVITEは`orgId/storeId`必須。既存メールINVITE禁止 |
| `admin-user-attach-existing` | ADMIN可 / SUPERVISORは同一管理ユニット内 / MANAGERは自グループUSERのみ |
| `group-create` | ADMIN / SUPERVISORのみ |
| `group-rename` | ADMIN / SUPERVISOR / MANAGER（自グループ） |
| `admin-management-unit-upsert` | ADMINのみ |
| `admin-management-unit-assign-supervisor` | ADMINのみ |
| `admin-store-subscription-set-plan` | ADMIN / SUPERVISOR |

## 7) 固定エラーメッセージ
- 新規招待で既存メールを指定した場合:
  - `すでに存在しているユーザーのため招待できません。別のメールアドレスを指定してください。`

## 8) RLS運用メモ
- `management_units` / `management_unit_supervisors` はADMINのみ参照/更新可
- `organizations` / `stores` / `memberships` のアクセス境界は管理ユニット関数で制御
- `memberships` の変更は原則Edge Function経由（クライアント直更新を避ける）

## 9) 監査シナリオ対応（2026-02-16）
| 監査シナリオ | 対応コマンド |
|---|---|
| 既存メール新規招待拒否 | `npm run audit:api:user-provisioning` / `npm run audit:e2e:existing-email-rejected` |
| ロール別UI表示（ADMIN/SUPERVISOR/MANAGER/USER） | `npm run audit:e2e:users` |
| 複数店舗選択時の制御 | `npm run audit:e2e:header-multiselect` / `npm run audit:e2e:multi-store-db-views` |
| 単一店舗時のプラットフォーム操作可否 | `npm run audit:e2e:platform-single-store` |
| 店舗管理（USER編集可否） | `npm run audit:e2e:store-management-user-edit` |
