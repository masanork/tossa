# 運用・移行・復元手順

2026-10-07。本書は実行手順であり、本番作業の完了記録ではない。実行者、日時、対象環境、結果を作業記録に残す。

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
- バックアップは毎日12:00 JST。最新成功時刻とテーブル件数を見る。保持は30世代で、手動実行も一世代として数える。毎分Cronは公開一覧の更新要求、10分Cronはアクセスログ保守と更新要求。
- 管理画面のバックアップ欄で最新の保存日時、データ取得開始時刻、確認時点の経過時間、一覧内の合計容量を確認する。取得開始から26時間以上は要確認と表示する。旧アーカイブで取得時刻がなければ保存日時を使う。判定はサーバーの確認日時を使う。一覧の取得失敗は「保存実績を確認できません」と表示し、バックアップなしとは区別する。手動保存も含むため、直近の自動Cron成功や復元検証の代わりにはならない。
- 新しい保存データの「スナップショット準備」は整合した一時コピーと件数収集までの時間。手動実行結果の「処理時間」はページ読み出し・JSON生成・R2保存・世代整理までを含む。生成時間を記録していない旧アーカイブは `-` と表示する。日次Cronは `event: database_backup` の構造化ログに成功/失敗、件数、UTF-8バイト数、全処理時間を記録する。手動実行との重複では `skipped: true` を記録し、失敗アラートを送らない。手動側には409と再試行の案内を返す。バックアップ本体はログに出さない。
- CloudflareのWorkerエラー率、D1使用量、書込/通知Queueの滞留、DLQ件数、R2保存容量を確認する。初期の対応目安は「5xxが5分続く」「write queueが5分以上滞留」「DLQが1件以上」「最終バックアップ成功から26時間以上」。これは運営上の目安で、サービス保証値ではない。
- 障害時は時刻、影響、直前の変更、Queue状態を記録し、アプリの緊急アナウンスまたは既定の連絡経路で知らせる。ログやバックアップをそのまま一般公開しない。

## 公開一覧と規模の確認

公開フィード更新は書込Queueへ集約し、consumer並列数を1に制限している。毎分のCronと書き込み後に更新を要求する。管理画面からの更新は受付後に順次処理されるため、受付表示を更新完了として扱わず、後から「規模」の鮮度を確認する。生成後120秒以内のKVスナップショットを採用するが、地域間の伝播・公開キャッシュ・Queue滞留もあるため、表示の反映期限ではない。明示更新はD1を読む。

一斉Pushは対象確認を100件ずつQueueで行い、別の配信ジョブへ渡す。受付は端末への到着証明ではない。ページ再配送・配信再試行では送信が重複しうる。APIの送信件数0と`queued: true`は受付状態を表す。[負荷測定と次の手順](capacity.md)を参照。

Workersログは10%サンプリング。全処理の証跡として使わず、指標・管理画面・保存記録と照合する。書込Queueは直列のため最古の待ち時間とDLQを特に確認する。外部ヘルス・滞留・DLQ検査は追加した。外部メール通知の権限と宛先設定、実着信確認は残る。

## Queue障害

書込・通知とも最大5回の再試行後に専用DLQへ送る。[Queuesの配信保証](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)は少なくとも一度の配信なので、同じ処理が届くことを前提にする。

1. DB・R2・通知先の失敗原因を特定し修正する。DLQのメッセージは削除前に非公開で保存する。
2. 対象の操作ID、投稿ID、観測時刻、受領記録を確認する。
3. 原因修正後の再投入は元の操作IDを保つ。新しいIDに変えると重複防止を失う。新しい観測より古い更新や更新競合は再適用しない。通知は重複する可能性があるため影響を確認する。
4. 結果、失敗件数、再投入件数を記録する。DLQを見ずに全削除しない。

## 管理者への障害通知

当面の通知先は、現在 `admin` の権限を持ち、アカウント画面でメールアドレスの確認を完了した利用者。未確認・確認待ちのアドレス、一般利用者、モデレーターには送らない。権限やメールの変更は通知時のDB照会で反映する。送信元は既存のEmail Service bindingを使う `noreply@tossa.app`。各受信者のアドレスを互いに見せず、BCCを50件ずつに分ける。

画面/APIの未処理エラー、日次バックアップ、定期保守・公開一覧更新、書込・通知Queueの失敗を通知する。メール本文は発生元と検出時刻、確認先だけとし、投稿・メッセージ・認証情報・生の例外やリクエストを含めない。Webhookは将来の外部監視用として任意に併用できる。

同じ発生元の通知はD1の `tossa_alert_control` で原子的に5分間抑制する。通知処理の全部または一部が失敗した場合は1分へ短縮し、その後の失敗検知時に再試行できる。再送で既に受理された受信者へ重複する可能性はある。通知失敗は元の画面応答やQueue再試行を妨げない。制御表は初回通知時に作り、17表のバックアップ・復元対象には含めない。送信結果は `event: operational_alert`、`source`、`accepted`、`incomplete` で記録し、メールアドレスはログに出さない。

管理画面のバックアップ欄で、メール送信機能と確認済み管理者メールの件数を確認する。設定済み表示は受信の保証ではない。状態の照会が失敗した場合は不明と表示し、取得できたR2の保存実績は引き続き表示する。2026-10-05の読み取り検査では確認済み管理者メールは1件、Webhookは未設定だった。送信ドメインの一覧照会は手元のCloudflare API tokenの権限不足で確認できなかった。受信箱への実配送確認は運営担当者が行う。

D1自体が停止すると、現在の管理者と送信抑制を確認できないためメールは送れない。アプリ全体の停止もこの内部通知では検出できない。当面はCloudflareの稼働状況と本番スモークを併用し、独立した監視は今後の運用要件に合わせて追加する。

### 管理者・代替担当者の読み取り検査

各本人がPasskeyでログインしたセッションを利用し、`SMOKE_ADMIN_TOKEN` と `SMOKE_ALT_ADMIN_TOKEN` を端末の環境変数へ設定する。トークンをコマンド引数、ファイル、作業記録へ貼り付けない。実行者の端末で入力を隠して設定する例:

```bash
read -rs SMOKE_ADMIN_TOKEN
read -rs SMOKE_ALT_ADMIN_TOKEN
export SMOKE_ADMIN_TOKEN SMOKE_ALT_ADMIN_TOKEN
npm run smoke:admin
unset SMOKE_ADMIN_TOKEN SMOKE_ALT_ADMIN_TOKEN
```

検査はGETだけで、異なる管理者2人の権限、報告一覧の閲覧、バックアップ一覧・取得時刻・26時間以内の鮮度、通知先の設定を確認する。宛先、利用者ID、投稿内容、バックアップのキー、トークンは出力しない。代替担当者が未定の場合は実行を完了扱いにしない。任意の `SMOKE_MODERATOR_TOKEN` があれば、モデレーターの報告閲覧とバックアップ拒否も検査する。報告の解決・運営確認・バックアップの作成やダウンロード、実際のメール受信は[試用手順](PILOT.md)で別に確認する。

## バックアップ復元演習

バックアップは17対象表をD1内の一時コピーへ原子的に保存し、不変のコピーからv2 JSONを分割送信する。制御用の `tossa_backup_control` と `tossa_backup_snapshot_…` は復元対象に含めない。制御表は初回実行時に作成される。通常はコピーを処理終了時に削除し、強制終了の残骸は次回実行時に削除する。残骸削除と旧世代整理には各100件/実行の上限があり、残りは次回へ持ち越す。詳細な容量制約は[バックアップの規模と上限](capacity.md#バックアップの規模と上限)を参照する。

### 日次保管の間の変更

独立した日次R2アーカイブだけで復元する場合は、取得時点より後の変更を失う。日次実行が成功していれば最大約24時間分だが、失敗するとさらに長くなる。D1には自動で有効な[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)もあり、Paidでは直近30日間の分単位の状態へ戻せる。2026-10-05に本番 `tossa-db` の現在の復元ポイントを読み取れることを確認した。復元操作は行っていない。

```bash
npx wrangler d1 info tossa-db
npx wrangler d1 time-travel info tossa-db
```

障害時は復元したいUTC時刻を特定し、`d1 time-travel info tossa-db --timestamp=…` で対応するbookmarkを取得する。Time Travelの復元は本番DBをその場で上書きし、後続の変更を取り除くため、書込・Queue消費を止め、現在のDBを別途退避して、対象時刻と失う変更を確認してから実施する。R2画像やQueueの状態はD1と一緒に戻らない。実行前後のbookmarkを記録し、投稿・履歴・権限と画像の対応を検査してから書込を再開する。アカウント障害や保存期間外に備えるR2アーカイブと隔離DBへの復元演習も継続する。

### 隔離DBへのv2アーカイブ復元

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

### 合成データによるローカル復元演習

```bash
npm run backup:drill
```

使い捨てのWrangler設定とローカルD1/R2だけで、本番のバックアップ関数、R2 multipart保存、v2アーカイブ取得、復元SQLの生成、別の空のD1への投入を一通り実行する。全バインディングを `remote=false` とし、CLIは `--local` を明示する。Cloudflareの認証環境変数を子プロセスから外し、127.0.0.1だけで待ち受ける。既存の開発DBも変更しない。終了時はWorkerを停止し、一時データを削除する。

150件の合成投稿を含む17表を使い、日本語・引用符・NUL・NULLと100KBを超える単一値を検査する。実測したmultipartのパート数・容量、復元SQLの最大文長、17表の件数、文字列のUTF-8バイト一致、外部キー・`quick_check`、リース解放、一時テーブル0件をJSONで報告する。この演習はCIでも実行する。本番データの復元成功や、本番規模の性能測定を代替する検査ではない。

復元SQLは[D1のSQL文100,000バイト上限](https://developers.cloudflare.com/d1/platform/limits/)を超えないよう64KiB以下に抑える。大きい文字列は24KiBずつBLOBの作業表に構築し、完成した値を実テーブルへ一度だけ挿入する。途中状態の行を実テーブルへ入れず、最後に作業表を削除する。

## tsudoi統計の取り込み前プレビュー

管理画面の「データ合流」で、tsudoi統計のJSONを読み込み、対応先の投稿IDを指定してプレビューする。現在の管理者だけが利用できる。これはtossa側の暫定的な受け入れ形式で、tsudoiの公式フィード仕様ではない。フィードが確定したら、その形式からこの正規化形式への変換を用意する。

例は [tsudoi統計サンプル](examples/tsudoi-statistics-preview.json)。実際の施設・統計ではなく、避難所43人・定員100人と、人数非公開のイベントを含む合成データ。サンプルのリンク先も例示用。入力は公開可能な集計だけとし、名簿・個人の行動履歴・認証情報を含めない。

- `format`: `tossa-statistics-preview-v1`、`source`: `tsudoi`、`visibility`: `public_aggregate` を指定する。未知の項目は受け付けず、送信全体は1MiB・統計100件以内に制限する。
- 各統計は安定した `id`、正の整数の `revision`、対象の `entity.kind`（`shelter` / `event`）・`entity.id`・`entity.label`、指標、状態、値、集計時刻、出典URLを持つ。出典URLはHTTPSの公開リンクを指定する。このプレビューでは外部URLへアクセスしない。
- 指標は `current_occupancy`（集計時点の避難所滞在人数）、`capacity`（定員）、`participants_unique`（期間内の実人数）、`attendance_total`（期間内の延べ人数）。人数の意味や測定方法が異なる指標を同じものとして変換しない。期間内の指標には `period.start` / `period.end` が必要で、定員・現在滞在人数には指定しない。
- `status: reported` はゼロを含む非負の整数、`unavailable`（未取得）と `withheld`（非公開）は `value: null` を指定する。ゼロと未取得・非公開を区別する。
- `observedAt` は集計時点、`generatedAt` は提供側のデータ生成時刻、プレビューの `checkedAt` はtossaが検証した時刻。時刻にはタイムゾーンが必要。JSONの新しい取得日時だけで古い集計を最新扱いにしない。
- 対応付けは対象種別と外部IDごとに手動指定する。名前だけで自動統合しない。未指定の対象は未対応と表示する。存在しない投稿、同じ対象や投稿への重複した対応付けはエラーとする。

APIは `POST /api/settings/statistics/preview` に、管理者のBearer認証と `Content-Type: application/json` で `{ "feed": <上記形式>, "mappings": [{ "kind": "shelter", "externalId": "shelter-001", "postId": "<既存投稿ID>" }] }` を送る。応答は検証済みの統計と対応先の投稿ID・タイトル、未対応件数だけで、投稿者情報は返さない。現在の権限をDBで確認するため降格・削除後のセッションでは利用できない。

プレビューはDB保存・公開・定期取得を行わず、既存投稿の内容・状態・運営確認を変更しない。訂正を示す版番号は検証・表示するが、複数の取得結果間の保存履歴や旧版への巻き戻し防止は永続取り込みを追加する段階で実装する。同一入力内の重複・矛盾はエラーにする。実フィードとの互換性、更新頻度・公開範囲・訂正と撤回の扱いは接続時に確認する。

## 更新時の確認

`npm run format:check`、`lint`、`knip`、`typecheck`、`test:coverage`、`test:e2e`、`build` を通す。E2Eは一時ディレクトリに独立したDBを作り、開発者の既存ローカルDBを変更しない。

現行CIはmainへのpush成功後に自動デプロイする。資源作成と移行が終わるまではmainへpushしない。デプロイ後はインストール済みPWAも開き、更新前の画面と未送信データが残る状況を確認する。

PWAの画面キャッシュはビルド内容ごとに版を生成する。新しい版の保存に失敗した場合は以前の版を保持し、成功した場合も開いている画面の入力を中断しない。下書きを保存して同じサイトのPWA・ブラウザータブをすべて閉じ、再度開くと新版へ切り替わる。保存領域の消去は未送信データを失うため、更新手順には含めない。[実機での確認順](PILOT.md#pwa更新の確認順)を参照する。

Mobile Safari相当の通信断テストは、[Playwright WebKitのオフライン切替の既知不具合](https://github.com/microsoft/playwright/issues/42775)を避け、テスト専用の中継サーバーで接続を切る。実際にネットワーク取得が失敗する状態でService Workerのキャッシュと再送を検証する。Safariの生体認証は物理端末で別途確認する。

IndexedDBへの初回移行ではService Workerが同じサイトの全画面へ保存方式の対応を照会する。旧版や応答できない画面があれば移行・変更・再送を止め、全画面を閉じるよう案内する。移行確定前にはlocalStorage原本を除かない。移行後に旧原本が変更された場合も自動再取り込みはせず、書き出しと明示復旧を経る。サイトデータの消去で更新しない。

## 外部のヘルス・Queue監視

[operations.yml](../.github/workflows/operations.yml)は5分間隔と手動実行に対応し、Worker経由ではなくCloudflare Queue REST指標を読み取る。両通常Queueの最古待ち時間が300秒以上、DLQが1件以上、ヘルスの非200・非JSON・内容不一致・タイムアウト、Queue観測失敗を異常とする。未知の最古時刻を正常な0秒へ置き換えない。Queue APIが失敗してもヘルスを検査する。read/pull/ack/purgeでメッセージを変更しない。

通常のCloudflare account/token Secretsは既存CIと共通。メール送信にはproduction環境へ `CLOUDFLARE_EMAIL_API_TOKEN`（対象accountのEmail Sending送信権限）と `OPERATIONAL_ALERT_RECIPIENTS`（現在管理者に設定され、検証済みのメールアドレス。複数はカンマ区切り）を設定する。送信元は既存の `noreply@tossa.app`。宛先はBCCで送信し、アドレス・token・API応答本文を標準出力へ出さない。管理者の追加・降格・削除・メール変更時には、この外部監視用の宛先Secretも更新する。外部監視の宛先はWorker内のDB照会による自動選択とは別で、DB障害時にも使える運営設定である。

2026-10-07の読み取り確認はヘルス200、4Queueの滞留0。メール用Secretは未設定で、出力は `notificationsConfigured:false` / `notification:unconfigured`。正常時の監視は成功し、異常検出時に通知できなければ失敗する。既存のWorker内の管理者メール通知を置き換えない。外部の実メール通知は未稼働として記録する。

```sh
OPERATIONAL_ALERT_DRY_RUN=true npm run monitor:operations
```

このdry-runはメールを送らない。手動workflowまたはCLI出力の時刻、ヘルス、4Queue、通知設定状態を記録する。観測APIの値は近似なのでCloudflareの画面とD1で保存された操作を照合する。GitHub scheduleは遅延・欠落しうる。現在は単発異常を検出し、毎回通知対象となるため、継続性判定・通知の重複抑制・復旧通知は次の改善候補。

## 200ページ上限を超えるSQL退避

`npm run backup:export -- --local-drill --rows=30000` は一時ディレクトリのlocal D1だけで3万投稿をexportし、別のlocal D1へ復元する。30,000投稿とユーザー・端末各1、計30,002件、全17表の件数、実FK参照、外部キー・quick_checkを検査した。SQLは17,728,583バイト。投稿表だけで128行/ページなら235ページとなり、日次JSONの200ページ上限を超える行数を扱った。これはlocal SQL経路の検証で、本番の処理時間・R2保存成功の証明ではない。

remote modeは対象account・DB名・UUID・非公開bucketと、その全値の完全一致確認文字列を必須にする。実行例の各値を管理者が現在の資源と照合する。

```sh
npm run backup:export -- --remote-export \
  --account-id=<account-id> --database-name=tossa-db --database-id=<uuid> \
  --private-bucket=tossa-backups \
  --confirm-target=<account-id>/tossa-db/<uuid>/tossa-backups \
  --archive-dir=<非公開ディレクトリ>
```

この経路は最大100MiBの17表SQLを0700ディレクトリ・0600ファイルへ出力し、FK親先行の順序で別のlocal D1へ復元、件数・外部キー・quick_checkを検査する。R2公開URL無効とカスタムドメインなしを確認し、新しい保存キーへupload後、読み戻しSHA-256を照合する。既存世代は置き換えない。R2保存に失敗した場合も復元検証済みのlocal SQLは残し、R2保存状態をmanifestで区別する。出力やログにはtoken、署名URL、データ本文を含めない。

SQLはv2 JSON形式ではないため `backup:restore` のJSON変換へ渡さない。実際のremote exportとR2保管は未実施。日次JSONの200ページ上限は維持する。並行した書き込み中のクロステーブル一貫性はこのツールでは保証せず、運営上の書込停止・取得時点と変更の扱いを決めてから本番の退避/復元を検証する。100MiBを超える場合のストリーム保管と定期化も残る。
