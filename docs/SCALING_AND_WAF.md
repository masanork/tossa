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
