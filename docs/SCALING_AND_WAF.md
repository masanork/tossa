# tossa - 高負荷スケーリング・WAF・Cloudflare Queues 運用設計書

本書は、大規模災害時（数万〜数百万人規模のアクセス集中）において `tossa` の安定稼働・セキュリティ・ゼロダウンタイムを維持するためのインフラ設計および Cloudflare 運用設定ガイドです。

---

## 1. 全体スケーリング・アーキテクチャ

```
[ 被災者・自治体・外部連携 (数十万〜数千万人) ]
              │
   (Anycast / Global Edge)
              ▼
┌────────────────────────────────────────────────────────┐
│ Cloudflare Edge CDN & WAF                              │
│                                                        │
│ 1. WAF / DDoS 防御 & IP/Cookie Rate Limiting           │
│ 2. 静的 SPA アセット (HTML/JS/CSS) キャッシュ (99.9%)   │
│ 3. タイムライン API (CDN-Cache-Control: 5秒集約) (99%) │
│ 4. 写真・メディア (R2 + 1年間イミュータブルキャッシュ)  │
│ 5. GeoJSON / 自治体連携フィード (30秒集約) (99%)       │
└─────────────┬────────────────────────────┬─────────────┘
              │ (MISS 時のみ)              │ (画像取得)
              ▼                            ▼
┌───────────────────────────┐ ┌──────────────────────────┐
│ Cloudflare Workers API    │ │ Cloudflare R2 Storage    │
│                           │ │ (tossa-images)           │
│ - 閲覧時 DB 書き込み 0件   │ └──────────────────────────┘
│ - 署名付き Cookie セッション│
│ - NAT 巻き添え防止リミッター│
└──────┬─────────────┬──────┘
       │ (書き込み)   │ (1万人超 一斉Push)
       ▼             ▼
┌──────────────┐ ┌───────────────────────────────────────┐
│ Cloudflare   │ │ Cloudflare Queues                     │
│ D1 Database  │ │ (tossa-push-queue)                    │
│ (単一Primary)│ └───────────┬───────────────────────────┘
└──────────────┘             │ (非同期 Consumer)
                             ▼
                 ┌───────────────────────┐
                 │ Push Notification     │
                 │ Workers (25件並列配信)│
                 └───────────────────────┘
```

---

## 2. Cloudflare WAF / レートリミット推奨設定

災害時にはリロード連打（F5アタック）や、混乱に乗じた虚偽投稿、スクレイピング BOT による負荷が想定されます。
Workers 内のインメモリ防御に加え、Cloudflare ダッシュボード（または Terraform / wrangler）で以下の WAF ルールを有効化することを推奨します。

### ルール 1: 投稿・ステータス更新のスパム防御 (Rate Limiting)

- **対象**: `http.request.uri.path in {"/api/posts"}` and `http.request.method in {"POST"}`
- **制限値**: 同一 IP アドレスあたり **1分間に 15 リクエスト**
- **アクション**: HTTP 429 (Too Many Requests) 返却

### ルール 2: 暗号化メッセージの過剰送信防御 (Rate Limiting)

- **対象**: `http.request.uri.path contains "/api/threads"` and `http.request.method in {"POST"}`
- **制限値**: 同一 IP アドレスあたり **1分間に 30 リクエスト**
- **アクション**: HTTP 429 返却

### ルール 3: Passkey / 認証総当たり攻撃防御 (Rate Limiting)

- **対象**: `http.request.uri.path contains "/api/auth"` and `http.request.method in {"POST"}`
- **制限値**: 同一 IP アドレスあたり **1分間に 10 リクエスト**
- **アクション**: 5分間のマネージドチャレンジ（Managed Challenge）またはブロック

### ルール 4: 避難所 Wi-Fi の NAT 巻き添え防止（アプリケーション層）

避難所の公衆 Wi-Fi（同一グローバル IP を数十〜数百人で共有する CGNAT 環境）において、同一 IP の誰かが連打したことで他の被災者全員が投稿できなくなるのを防ぐため、`src/middleware/rateLimit.ts` では **端末 Cookie (`deviceSessionId`) を優先キー** として使用しています。

---

## 3. Cloudflare Queues による大規模 Web Push 配信

### 概要

- 購読者が **1万人〜10万人規模** に達した場合、HTTP リクエストの同期処理（30秒〜数分でタイムアウト）では全件配信が困難になります。
- `env.PUSH_QUEUE` をバインドすることで、管理者の配信リクエストは **0.1秒で即座にエンキュー完了（202 Accepted）** し、バックグラウンドの Consumer Worker が安全に配信します。

### 本番有効化手順 (Workers Paid プラン)

1. Cloudflare CLI でキューを作成:
   ```bash
   npx wrangler queues create tossa-push-queue
   ```
2. `wrangler.toml` の以下のコメントアウトを解除:
   ```toml
   [[queues.producers]]
   binding = "PUSH_QUEUE"
   queue = "tossa-push-queue"

   [[queues.consumers]]
   queue = "tossa-push-queue"
   max_batch_size = 25
   max_batch_timeout = 5
   ```
3. デプロイ:
   ```bash
   npm run deploy
   ```

※ `PUSH_QUEUE` がバインドされていないローカル・開発環境では、自動的に従来のインラインチャンク配信（25件バッチ）へフォールバックするため、開発環境のセットアップは不要です。

---

## 4. エッジキャッシュ & 外部連携 API

| エンドポイント                                       | キャッシュ設定                                                                                    | 目的                                                                                        |
| :--------------------------------------------------- | :------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------ |
| `GET /api/posts` (一覧)                              | `CDN-Cache-Control: public, max-age=5, stale-while-revalidate=30`<br>`Cache-Control: no-cache`    | 同一エリアへの閲覧トラフィックをエッジで 99% 吸収。ブラウザには古いデータを残さず即時反映。 |
| `GET /api/feed.json`<br>`GET /api/federation/export` | `CDN-Cache-Control: public, max-age=30, stale-while-revalidate=60`<br>`Cache-Control: no-cache`   | 報道機関・外部 GIS・ボランティアによる高頻度ポーリングから D1 を保護。                      |
| `GET /api/images/:key`                               | `Cache-Control: public, max-age=31536000, immutable`                                              | R2 からの配信後、世界中の CDN エッジに1年間恒久キャッシュ。帯域・容量を極小化。             |
| `GET /api/categories`                                | `CDN-Cache-Control: public, max-age=300, stale-while-revalidate=600`<br>`Cache-Control: no-cache` | カテゴリ情報の 5分間エッジキャッシュ。                                                      |

---

## 5. 超大規模投稿ラッシュ時の書き込み平滑化キュー (Write Buffer)

### 概要

- 震度7等の発災直後、秒間数百〜数千件の投稿や状況更新が殺到した場合、SQLite ベースの D1 は書き込みロックの競合により 500/504 タイムアウトエラーが発生するリスクがあります。
- `WRITE_QUEUE`（Cloudflare Queues）を有効化すると、`POST /api/posts` および `POST /api/posts/:id/status` は**即座にキューへ送出して 201/200（`buffered: true`）を返却**します。
- クライアント側（ブラウザ）は端末ローカルストレージ（`tossa_my_posts`）にも即時保存するため、ユーザー画面上は即座に反映され、体感レスポンスが一切損なわれません。
- バックグラウンドの Queue Consumer が安全に順次（またはバッチで）D1 に書き込むことで、SQLite のロック待ちを完全解消します。

### 本番有効化手順 (Workers Paid プラン)

1. キューを作成:
   ```bash
   npx wrangler queues create tossa-write-queue
   ```
2. `wrangler.toml` の以下のコメントアウトを解除:
   ```toml
   [[queues.producers]]
   binding = "WRITE_QUEUE"
   queue = "tossa-write-queue"

   [[queues.consumers]]
   queue = "tossa-write-queue"
   max_batch_size = 50
   max_batch_timeout = 5
   ```
3. デプロイ:
   ```bash
   npm run deploy
   ```

※ `WRITE_QUEUE` 未設定環境（ローカル・テスト環境）では自動的に同期書き込みへフォールバックします。

---

## 6. D1 データベースの定期自動バックアップ & R2 アーカイビング

### 概要

- Cloudflare Cron Triggers（`scheduled` イベント）により、D1 の全テーブル（`posts`, `users`, `system_settings`, `status_updates`, `push_subscriptions` 等）を定期的に JSON ダンプし、Cloudflare R2（`backups/` プレフィックス）に自動保存します。
- **自動ローテーション**: ストレージ肥大化を防ぐため、最新 30 世代を保持し、古いバックアップは自動削除されます。
- **手動実行・確認 API**:
  - 管理者用エンドポイント: `POST /api/settings/backup`（緊急手動バックアップ）
  - バックアップ一覧取得: `GET /api/settings/backups`

### 設定 (`wrangler.toml`)

```toml
[triggers]
crons = ["0 3 * * *"] # 毎日 12:00 JST (03:00 UTC) 自動バックアップ
```

---

## 7. 低速回線・被災地帯域制限下のフロントエンドコード分割 (Code Splitting)

### 概要

- 災害時はモバイル通信キャリアの輻輳（通信速度制限・3Gパケット落ち）が発生します。
- 初期一覧（フィード画面）に不要な重量級ライブラリおよびモーダルを徹底的に動的インポート（Lazy Loading）化しました：
  - **Leaflet（地図レンダリング 148KB）**: 「地図」タブをタップした時のみロード
  - **jsQR（QRスキャナー 130KB）**: QRスキャナーを開いた時のみロード
  - **exifr（EXIF/C2PA画像パーサー 75KB）**: 写真添付時のみロード
  - **QRCode（QR生成エンジン 23KB）**: QR共有を開いた時のみロード
  - **各モーダル群（投稿、管理、安否メッセージ、オフライン地図、マイページ等）**: ユーザーが開いた時のみロード
- **効果**:
  - 初期 JavaScript バンドルサイズ: **706KB → 274KB（gzip 圧縮後: わずか 80KB！）**
  - **約 61% の転送量削減**により、128kbps〜256kbps の超低速回線でも 1〜2秒以内に初期フィードが表示されます。
