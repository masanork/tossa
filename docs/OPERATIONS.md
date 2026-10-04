# 運用・移行・復元手順

2026-10-04。本書は実行手順であり、本番作業の完了記録ではない。実行者、日時、対象環境、結果を作業記録に残す。

## 今回の本番移行

1. 管理者のPasskeyで現在のログインを確認する。作業者と代替担当者を決める。`wrangler whoami` で対象アカウントを確認する。
2. 新規資源を作成する。既にある場合は名前と設定を確認する。

```bash
npx wrangler r2 bucket create tossa-backups
npx wrangler queues create tossa-push-deadletter
npx wrangler queues create tossa-write-deadletter
```

`tossa-backups` は公開アクセス、r2.dev、カスタムドメインを有効にしない。権限を運営担当者だけに限定する。設定は [R2公開アクセスの公式説明](https://developers.cloudflare.com/r2/buckets/public-buckets/)を参照する。

3. 一時的に書込を止め、既存のwrite queueが処理し終わったことを確認する。管理画面だけで全書込を停止できる機能はないので、必要ならCloudflare側でPOST/PUT/DELETEのメンテナンス応答を設定する。読み取りは維持する。
4. 現行D1を安全な端末の非公開フォルダーへエクスポートする。下の出力先は例で、Gitや共有フォルダーに置かない。

```bash
npx wrangler d1 export tossa-db --remote --output /private/tmp/tossa-before-reliability.sql
```

認証情報、端末情報、メッセージ等を含むため、出力ファイルをアクセス制限された保管先へ移す。画像本体はD1にない。`tossa-images` のオブジェクトも別途保全する。

5. `PRAGMA table_info(posts)` で `observed_at` がまだないことを確認する。既存の旧スキーマに対して次を**一度だけ**実行する。再実行は不可。新規DBには `schema.sql` を使い、この移行は実行しない。

```bash
npx wrangler d1 execute tossa-db --remote --command 'PRAGMA table_info(posts)'
npx wrangler d1 execute tossa-db --remote --file scripts/migrate-reliability.sql
npm run deploy
```

移行は履歴上の `is_verified` を解除する。従来のログイン由来の印を運営確認と誤認させないためであり、必要な投稿は運営者が再確認する。認証器を持たない仮登録管理者も一般ユーザーへ戻す。投稿、履歴、認証済みユーザーのデータは保持する。

6. 新しいWorkerの稼働を確認して書込を再開する。匿名投稿・再送・Passkeyログイン・管理者の報告画面・運営確認・地図取得を確認する。`/api/images/backups%2F...` は404、公開投稿JSONに `author_cookie_id` がないことを確認する。
7. 管理画面で手動バックアップを作り、一覧とダウンロードを確認する。私用バケット内のv2アーカイブで下記の復元演習を実施する。
8. 旧 `tossa-images/backups/` の公開設定と既存リンクを点検する。必要なアーカイブは非公開先にコピーし、内容と件数を確認してから保管・削除方針を決める。新APIの404だけでは、R2の直接公開URLを無効にできない。

## 毎日の担当作業

- 管理者・代替管理者・地域モデレーターの担当を実名または連絡可能な識別名で記録する。共有アカウントではなく各自のPasskeyを使う。
- 災害時は担当交代時に、未対応報告、古い情報、緊急アナウンス、避難場所の現状を確認する。運営確認は実際の確認後に付ける。通常時の確認頻度は地域試用で決める。
- バックアップは毎日12:00 JST。最新成功時刻とテーブル件数を見る。保持は30世代で、手動実行も一世代として数える。10分Cronは保守処理のみ。
- CloudflareのWorkerエラー率、D1使用量、書込/通知Queueの滞留、DLQ件数、R2保存容量を確認する。初期の対応目安は「5xxが5分続く」「write queueが5分以上滞留」「DLQが1件以上」「最終バックアップ成功から26時間以上」。これは運営上の目安で、サービス保証値ではない。
- 障害時は時刻、影響、直前の変更、Queue状態を記録し、アプリの緊急アナウンスまたは既定の連絡経路で知らせる。ログやバックアップをそのまま一般公開しない。

## Queue障害

書込・通知とも最大5回の再試行後に専用DLQへ送る。[Queuesの配信保証](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)は少なくとも一度の配信なので、同じ処理が届くことを前提にする。

1. DB・R2・通知先の失敗原因を特定し修正する。DLQのメッセージは削除前に非公開で保存する。
2. 対象の操作ID、投稿ID、観測時刻、受領記録を確認する。
3. 原因修正後の再投入は元の操作IDを保つ。新しいIDに変えると重複防止を失う。新しい観測より古い更新や更新競合は再適用しない。通知は重複する可能性があるため影響を確認する。
4. 結果、失敗件数、再投入件数を記録する。DLQを見ずに全削除しない。

## バックアップ復元演習

Node.js 22の `node:sqlite` が必要。v2は全テーブルと件数を検証し、不完全なアーカイブからは復元SQLを出力しない。v1には不足テーブルがあるのでこの手順では受け付けない。

```bash
npm run backup:restore -- /private/tmp/tossa-backup.json /private/tmp/tossa-recovery.sql
npx wrangler d1 create tossa-recovery-drill
```

作成結果のDB IDを使い、別のWrangler設定に `tossa-recovery-drill` を定義する。既存本番設定のDB IDを差し替えない。新DBのみにSQLを投入する。

```bash
npx wrangler d1 execute tossa-recovery-drill --remote --config /private/tmp/tossa-recovery.toml --file /private/tmp/tossa-recovery.sql
npx wrangler d1 execute tossa-recovery-drill --remote --config /private/tmp/tossa-recovery.toml --command 'PRAGMA foreign_key_check'
npx wrangler d1 execute tossa-recovery-drill --remote --config /private/tmp/tossa-recovery.toml --command 'PRAGMA quick_check'
```

全テーブルの件数をアーカイブの `metadata.tableCounts` と比較し、災害設定・投稿・履歴・権限・メッセージを限定した検証環境で確認する。画像URLは別保管したR2画像と対応を確認する。検証環境は一般公開しない。

開始・終了時刻と検証結果を記録する。復元が必要な障害では、検証後に新DBを利用する設定を作り、切替時点と書込再開を決める。本番DBへの上書きや `DROP TABLE` はこの演習に含めない。WorkerだけのロールバックではDB移行は戻らないことにも注意する。

## 更新時の確認

`npm run format:check`、`lint`、`knip`、`typecheck`、`test:coverage`、`test:e2e`、`build` を通す。E2Eは一時ディレクトリに独立したDBを作り、開発者の既存ローカルDBを変更しない。

現行CIはmainへのpush成功後に自動デプロイする。資源作成と移行が終わるまではmainへpushしない。デプロイ後はインストール済みPWAも開き、更新前の画面と未送信データが残る状況を確認する。

Mobile Safari相当の通信断テストは、[Playwright WebKitのオフライン切替の既知不具合](https://github.com/microsoft/playwright/issues/42775)を避け、テスト専用の中継サーバーで接続を切る。実際にネットワーク取得が失敗する状態でService Workerのキャッシュと再送を検証する。Safariの生体認証は物理端末で別途確認する。
