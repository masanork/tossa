# tossa (咄嗟)

[English](README.md) | [日本語](README.ja.md)

> 地域の状況を迅速に共有・確認できる超軽量情報プラットフォーム。  
> 日常の地域・店舗情報から発災時の避難・給水情報まで、投稿から自発的に成長するボキャブラリでシームレスに対応。  
> EXIF GPS自動ピン配置、C2PA真正性認証、E2EE暗号化連絡、多言語対応（日本語・やさしい日本語・英語）、コミュニティ現地確認を完備した Cloudflare ネイティブ構成。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/MasKusuno/tossa)

---

## 🌟 主な特徴

1. **投稿から自発的に成長するボキャブラリ（タグ統合フィルター）**
   - 固定カテゴリの押し付けを廃止。住民や関係者が投稿した `#給水` `#避難所` `#カフェ` などのタグが直近更新順・件数順に自動集約。
   - 日常と発災時を人工的に分けず、状況の変化に応じて自律的に最適な情報板へ変容。
2. **写真による簡単投稿 & EXIF GPS 自動ピン配置**
   - 現場写真をアップロードするだけで、EXIF メタデータから撮影地点の緯度経度を自動抽出し、地図上にピンを自動配置。
   - ブラウザ側 Canvas による自動軽量化（長辺 1200px / WebP）により、不安定な通信環境でも爆速アップロード。
3. **C2PA (Content Authenticity) 真正性検証 & EXIF 鮮度表示**
   - 画像バイナリ内の JUMBF / C2PA 暗号署名を高速スキャンし、認証カメラ・機材で撮影された真正な写真であることを証明（改ざんやAIフェイクの防止）。
   - 撮影日時（EXIF）を明示し、古い写真の使い回しを検知・防止。
4. **Passkey PRF によるエンドツーエンド暗号化（E2EE）セキュア連絡**
   - WebAuthn PRF (Pseudo-Random Function) 拡張を活用し、ハードウェア生体認証から暗号鍵をセキュアに導出。
   - 避難所や店舗の管理者と住民が、サーバー管理者すら傍受不能なゼロ知識 E2EE メッセージングで相談・連絡可能。
5. **多言語・音声読み上げ & ウェブアクセシビリティ対応 (JIS X 8341-3:2016 適合レベルAA / WCAG 2.1/2.2 AA)**
   - デジタル社会推進標準ガイドライン群（DS-600番台 / ウェブアクセシビリティ導入ガイドブック）およびデジタル庁デザインシステムに準拠。
   - 日本語、外国人や子ども向けの「やさしい日本語 (Easy Japanese)」、英語に対応。言語切替時の `lang` 属性動的同期。
   - **Web Speech API 音声読み上げ**: 各投稿のタイトル・場所・ステータス・備考をワンタップで音声合成朗読（高齢者、弱視者、避難移動中の耳からの情報取得に対応）。
   - **文字サイズ変更機能**: 標準 (100%)・大 (115%)・特大 (130%) のフォントスケール切り替えに対応。
   - スキップリンク（本文へジャンプ）、全機能のキーボード操作、モーダルのフォーカストラップ＆復帰、スクリーンリーダー向け Live Region 動的通知、ピンチズーム許可、視覚効果の軽減（`prefers-reduced-motion`）を完備。
6. **情報源URLの信頼性ドメイン検証 & コミュニティ現地確認**
   - 情報源URLから自治体公式（`.go.jp`, `.lg.jp`）、大学（`.ac.jp`）、報道機関、SNS公式を自動判別し信頼度バッジを表示。
   - 「👍 現地で確認」ボタンにより、住民同士で情報のリアルタイムな正確性・有効性を支持・可視化。
7. **Passkey (WebAuthn) & Cookie セッション識別**
   - 未ログインでも端末固有のセキュア Cookie により即座に投稿・更新が可能。
   - Passkey 登録により Touch ID / Face ID / Windows Hello を用いた強固な認証へシームレスにアップグレード。
8. **圧倒的なスケーラビリティ & ゼロ・エグレスコスト**
   - Cloudflare Workers + D1 (SQLite) + Workers Static Assets の統合アーキテクチャ。
   - エッジキャッシュにより大規模災害時の急激なアクセス急増でも月額数ドル〜1万円台で安全稼働。
9. **PWA (Progressive Web App) & オフライン耐障害性**
   - Service Worker によりアプリシェルおよび直近の投稿一覧を自動キャッシュ。
   - 通信途絶時でも現場投稿やステータス更新をローカル Outbox に一時保存し、電波復旧時に自動同期。
10. **モバイル最適化マルチモーダル & ネイティブボトムシート**
    - 投稿作成中に Passkey 認証を行っても下書き内容を破棄せず保持する安全な多層モーダル管理。
    - スマホでの片手操作に適したボトムシート、ドラッグハンドル、ブラウザ「戻る」ボタン (`popstate`) による自然な閉じる操作。
11. **ダークモード＆ハイコントラスト災害モード**
    - 夜間や停電時の省電力（有機ELバッテリー消費抑制）に配慮したダークテーマ。
    - 屋外の直射日光下でも視認性を保つ白黒モノトーンのハイコントラスト緊急モード。
12. **オフライン直線距離＆方角コンパス表示・現在地ソート**
    - Haversine公式による完全クライアントサイド直線距離（m/km）および初頭方位角（0-360°）の即時計算。
    - 端末の地磁気センサー/ジャイロ（DeviceOrientation API）と連動したリアルタイム回転コンパス矢印。
    - 近い順（現在地）タイムラインソートおよび地図上での現在地パルス表示・現在地移動機能。
13. **避難所・給水所へのオフライン直行ナビゲーションHUD＆コンパス追従**
    - 選択した避難所・給水所に対して「避難案内」を起動し、画面下部にリアルタイム誘導HUD（Heads-Up Display）を常駐表示。
    - 端末の向きに合わせて追従する回転コンパス針、残り直線距離のリアルタイムカウントダウン、30m以内の自動到着判定通知。
    - 拡大コンパスローズ（8方位ダイアル表示）および地図上での破線ナビゲーションベクター線の自動描画・追従パン。
14. **投稿のQRコード表示 & 近接オフライン共有（オフラインQRスキャン＆ピア・ツー・ピア取り込み）**
    - 停電や基地局途絶による通信不能環境でも、各投稿のデータを軽量JSONに圧縮しSVG/PNGのQRコードとして画面表示。
    - 相手端末の内蔵カメラ（`BarcodeDetector` APIおよび純JS `jsQR`フォールバック）やスクショ画像読取で瞬時にスキャン・取り込み。
    - 受信した避難・災害情報はローカルストレージへ即時永続化され、電波ゼロでもタイムライン閲覧・地図表示・直行ナビゲーション（HUD）を即座に開始可能。
15. **RFC 8291/8292 Web Push 通知（VAPID）**
    - アプリを閉じているときや画面外でも届くブラウザプッシュ通知。VAPID署名＋AES-128-GCM暗号化ペイロードで完全標準準拠、Cloudflare Workers ネイティブ（Node.js不要）。
    - 緊急バナー更新・重要投稿・避難所/給水所ステータス変化を自動ブロードキャスト。地区別・通知種別フィルターにより必要な人に必要な情報のみ配信。
    - E2EEスレッドへのメッセージ到着も内容を一切送らずプライバシーを保護したまま通知。管理者向けブロードキャストパネルとアニメーション付きベルボタンで一発購読/解除。
16. **Model Context Protocol (MCP) リモートサーバー連携 (`/mcp`, `/api/mcp`)**
    - Claude Desktop、Cursor、Windsurf、Gemini CLI などの AI エージェントから、自然言語で生活・災害情報をリアルタイム検索・投稿・災害サマリー取得できる標準プロトコル（Streamable HTTP JSON-RPC 2.0 / SSE 対応）。
    - 管理画面（Passkey 認証）から Bearer API トークンを即座に発行可能。未認証エージェントでも災害情報の検索・サマリー作成を安全に利用可能。
17. **AI Discovery & Findability (`/llms.txt`, GeoRSS, SSR JSON-LD/OGP)**
    - `/llms.txt`: Perplexity、SearchGPT、Claude、Gemini 等の AI エンジン向け簡潔な要約と API 仕様書。
    - `/feed.xml`: GeoRSS (W3C Basic Geo) / RSS 2.0 フィード。位置情報付きニュースリーダーや防災ボットへ自動配信。
    - `/robots.txt`, `/sitemap.xml`: 検索エンジン・クローラー案内。
    - Dynamic SSR: 検索エンジンや SNS シェア向けに OGP および Schema.org (`DisasterReport`, `Place`, `EmergencyService`) を Cloudflare エッジで動的サーバーサイドレンダリング。
18. **オフライン地図タイルキャッシュ (IndexedDB & Cache API)**
    - 避難予定地や市街地の地図タイル（国土地理院・OpenStreetMap）を端末ローカルに事前ダウンロード。
    - 基地局停電時や完全圏外でも、地図上の避難所・給水所ピンをスムーズに閲覧可能。
19. **自治体・広域フェデレーション同期 (`/api/federation/sync`)**
    - 広域災害時に隣接自治体や他地域の tossa インスタンス同士で避難・被害状況を相互レプリケーション。
20. **体系的ヘルプ & ガイド機能（UI 組み込み）**
    - ヘッダーの「？」ボタンから、住民・避難者向け操作ガイド、オフライン防災ツール、セキュリティ解説、AI/MCP 設定 JSON のワンクリックコピーをいつでも閲覧可能。
21. **多層セキュリティガード (Security Headers, Body Limit & Edge Rate Limiting)**
    - 厳格な Content Security Policy (CSP)、`X-Content-Type-Options: nosniff`、Frame Protection。
    - 2MB ペイロードサイズ制限、悪意あるスパム投稿や DoS を遮断するエッジスライディングウィンドウ型レート制限。

---

## 🤖 Model Context Protocol (MCP) & AI エージェント連携

tossa は **Model Context Protocol (MCP)** のリモートサーバーを標準提供しています。Claude Desktop や Cursor、Gemini CLI などの AI クライアントから、自然言語で直接地域情報の検索や災害状況ブリーフィングの作成を行えます。

### Claude Desktop の設定 (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "tossa": {
      "url": "https://tossa.sorane.dev/mcp"
    }
  }
}
```

※ 認証が必要な操作（管理者権限での公式投稿など）を行う場合は、管理画面の「APIトークン発行」からトークンを取得し、以下のようにヘッダーを指定します：

```json
{
  "mcpServers": {
    "tossa": {
      "url": "https://tossa.sorane.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}
```

### 提供ツール一覧

- `search_posts`: 給水所、避難所、物資、店舗、イベントなどの検索（キーワード、エリア、カテゴリ、ステータス、タグ）
- `get_post`: 投稿の詳細、コミュニティ現地確認数、ステータス更新履歴の取得
- `get_emergency_summary`: 指定地域または全域の避難所・給水所・物資状況と内訳の即時集計
- `create_post`: 現場情報の新規投稿（AI による現場レポート連携）
- `update_post_status`: 施設の稼働・混雑・在庫状況の即時更新
- `get_categories` / `get_vocabulary_tags` / `get_areas`: カテゴリ・自律集約タグ・地区一覧の取得

---

## 🔍 AI Discovery & Findability (機械可読性)

- **AI エンジン向け要約**: [`/llms.txt`](/llms.txt)
- **位置情報付き GeoRSS**: [`/feed.xml`](/feed.xml)
- **サイトマップ**: [`/sitemap.xml`](/sitemap.xml)
- **クローラー設定**: [`/robots.txt`](/robots.txt)
- **動的 SSR & JSON-LD**: 検索エンジンや SNS クローラー向けにエッジでメタタグ・構造化データを即時展開

---

## 🛠 技術スタック

- **ランタイム / ホスティング**: Cloudflare Workers
- **設定ファイル**: `wrangler.toml` (Deploy to Cloudflare 完全対応)
- **API フレームワーク**: Hono
- **データベース**: Cloudflare D1 (SQLite)
- **フロントエンド**: Svelte 5 (Runes) + Vite + Tailwind CSS v4
- **国際化 (i18n)**: `@inlang/paraglide-js` + Svelte 5 Reactive State
- **暗号化 (E2EE)**: Web Crypto API (AES-GCM-256 + ECDH P-256) + WebAuthn PRF
- **メディア解析**: `exifr` (EXIF GPS・撮影日時抽出) + JUMBF/C2PA マニフェストスキャナー
- **認証**: WebAuthn / Passkey (`@simplewebauthn/server` & `@simplewebauthn/browser`)
- **マップ**: Leaflet + 国土地理院 住所検索 API + OpenStreetMap

---

## 🚀 ローカル開発環境の起動

```bash
# 1. 依存関係のインストール
npm install
npm --prefix web install

# 2. ローカル D1 データベースの初期化
npm run db:reset:local

# 3. ビルド & 開発サーバー起動 (ポート 8787)
npm run build
npm run dev
```

ブラウザで `http://localhost:8787` を開くと動作します。

---

## 🧪 品質保証 & テスト (Quality Assurance)

プロジェクトには包括的なテストと品質維持スイートが整備されています。

```bash
# 1. ユニット & 統合テスト (Vitest: D1 SQLite インメモリ高速実行)
npm test

# 2. ブラウザ E2E テスト (Playwright: 多言語切替・投稿・クッキー識別・Passkey)
npm run test:e2e

# 3. 型検査 (TypeScript & svelte-check)
npm run typecheck

# 4. リンター (ESLint flat config)
npm run lint
npm run lint:fix

# 5. フォーマッター (Prettier)
npm run format:check
npm run format
```

プルリクエストおよび `main` ブランチへのプッシュ時には、GitHub Actions CI (`.github/workflows/ci.yml`) によりこれらすべての検査が自動実行されます。

---

## 📦 Cloudflare への本番デプロイ

### 1. D1 データベースの作成

```bash
npx wrangler d1 create tossa-db
```

出力された `database_id` を [`wrangler.toml`](./wrangler.toml) の `database_id` に設定します。  
また、本番環境のドメインに合わせて `RP_ID` と `EXPECTED_ORIGIN` を設定します。

### 2. 本番 D1 へのスキーマ・シード投入

```bash
npm run db:init:remote
npm run db:seed:remote
```

### 3. デプロイ

```bash
npm run deploy
```

---

## 🔒 Passkey (WebAuthn) 管理者登録手順

1. 画面右上の **「管理」** ボタンをクリック
2. ユーザー名 `admin` のまま **「この端末を登録」** をクリック
3. 端末の生体認証（Touch ID / Face ID 等）で登録完了
4. 次回以降は **「Passkey でログイン」** をクリックするだけで即座にログインできます
5. ログイン後は、対象地域名（自治体名）や緊急アナウンス告知バーの設定・編集が可能です
