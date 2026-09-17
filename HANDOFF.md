# tossa（咄嗟）- プロジェクト構想・引き継ぎ書 (HANDOFF.md)

> **「咄嗟（とっさ）の機転で、即座に立ち上がる生活情報板」**  
> 日常は地域の生活・店舗・助け合いを共有し、発災時はワンクリックで避難・給水・ライフライン情報板へと切り替わる、Cloudflareネイティブの超軽量デュアルユースCMS。

---

## 1. コンセプトと背景

- **参考元（イマココナビ: `https://imacoco-navi.netlify.app/`）の思想を継承**:
  - 熊本地震の現場で実証された「避難所・給水・トイレ・物資・断水/停電」といった命に関わる情報の即時共有。
  - 「誰でも1タップで営業・在庫状況を更新できる」マイクロアップデート設計。
- **課題の解消と発展**:
  - **脱・固定スキーマ**: 日常（カフェ、イベント、地域掲示板）と発災時（給水、炊き出し、断水）をコード改修なしでタグ・属性として自由に拡張可能にする。
  - **脱・Firebase依存**: Cloudflare Workers + D1 で構築し、災害時のアクセス急増に耐えうるエッジキャッシュ設計とする。
  - **Passkey（WebAuthn）認証**: パスワードやメール不要。自治体職員や現地モデレーターが指紋・顔認証だけで安全・即座に管理権限を行使できるようにする。
- **ネーミングについて**:
  - 「にわか（俄）」のネットスラング的な揶揄・未熟なニュアンスを避け、「咄嗟の機転」「即座に動く」という機動性と前向きさを持つ **`tossa`（咄嗟）** を採用。

---

## 2. 技術スタック

| レイヤー           | 技術選定                   | 選定理由                                                           |
| ------------------ | -------------------------- | ------------------------------------------------------------------ |
| **ランタイム**     | **Cloudflare Workers**     | 世界中のエッジで稼働、コールドスタート実質0ms、高耐障害性          |
| **API**            | **Hono**                   | 超軽量（~15KB）、型安全RPC（`hono/client`）でフロントと完全連携    |
| **データベース**   | **Cloudflare D1 (SQLite)** | ゼロコンフィグ、高速読み込み、無料枠大（1日500万行読込）           |
| **フロントエンド** | **Svelte 5 + Vite**        | 圧倒的なバンドルサイズ極小化（低速回線・3G環境でも爆速起動）       |
| **配信構成**       | **Workers Static Assets**  | 1つのWorker内にSPAとAPIを同居（単一リポジトリ・単一デプロイ）      |
| **認証**           | **Passkey (WebAuthn)**     | `@simplewebauthn` ベースのコンパクト実装（パスワード・メール不要） |
| **スタイリング**   | **Tailwind CSS v4**        | モバイルファーストで無駄のないCSS生成                              |

---

## 3. コアアーキテクチャ

```
[ エッジ CDN (Cloudflare) ]
   │
   ├─ [静的アセット (Svelte 5 SPA)] ── キャッシュ配信（オフライン/PWA対応）
   │
   └─ [Hono API (/api/*)]
         │  ├─ エッジキャッシュ (Cache API: 5秒〜30秒) ── D1のアクセス負荷を99%遮断
         │  ├─ Passkey 認証 (/api/auth/*)
         │  └─ D1 Database (posts, categories, tags, status_updates)
```

---

## 4. データモデル設計方針（動的・柔軟な骨格）

EAVのような過度な抽象化は避け、**D1（SQLite）の JSON カラムを活用**して自由な属性追加を可能にします。

1. **`categories`**:
   - `id`, `name`, `icon` (絵文字), `color`, `scope` (`normal` / `disaster` / `both`), `sort_order`
2. **`posts`**:
   - `id`, `category_id`, `title`, `area`, `lat`, `lng`, `current_status`, `note`, `url`
   - **`attributes` (JSON)**: カテゴリごとに自由なタグ・詳細情報を持たせる
     - 発災時例: `{"supplies": ["水", "オムツ"], "water_source": "well", "toilet_type": "temporary"}`
     - 日常例: `{"wifi": true, "parking": true, "hours": "10:00-18:00"}`
   - `is_verified` (自治体・モデレーター公認フラグ)
3. **`status_updates`**:
   - 誰でも更新できるステータス履歴（追跡・モデレーション用）
4. **`users` / `credentials`**:
   - Passkey（公開鍵、Credential ID、署名カウンタ）を保持する最小テーブル

---

## 5. プロジェクトディレクトリ構成（予定）

```
tossa/
├── src/                  # バックエンド (Hono / Workers)
│   ├── index.ts          # APIルーティング & 静的アセット配信設定
│   ├── auth/             # Passkey (WebAuthn) 登録・検証ロジック
│   ├── routes/           # posts, categories, status などのAPI
│   └── db/               # D1 ヘルパー
├── web/                  # フロントエンド (Svelte 5 SPA)
│   ├── src/
│   │   ├── App.svelte
│   │   ├── routes/       # List, Map, Detail, Admin
│   │   ├── lib/          # UIコンポーネント (Badges, Form, Filters)
│   │   └── api.ts        # Hono RPC 型安全クライアント
│   └── index.html
├── schema.sql            # D1 スキーマ定義
├── seed.sql              # 平時・災害時初期カテゴリプリセット
└── wrangler.jsonc        # Cloudflare 統合設定
```

---

## 6. 開発ステップ（ロードマップ）

1. **Phase 1: 基礎基盤の構築**
   - リポジトリ初期化、Wrangler + Hono + Svelte 5 (Vite) のモノレポ設定
   - D1 スキーマ定義とローカル環境でのマイグレーション動作確認
2. **Phase 2: Passkey 認証モジュール**
   - 管理者・モデレーター用の WebAuthn 登録・ログインフロー実装
3. **Phase 3: 投稿・ステータス更新 API & キャッシュ層**
   - CRUD API、ステータス即時更新、Cloudflare Cache API による負荷軽減
4. **Phase 4: Svelte 5 モバイルファースト UI**
   - イマココナビ風のピル/タグUI、生活情報・ライフライン・物資のタブ切り替え
   - 地図（Leaflet / MapLibre）表示
5. **Phase 5: デュアルユース切り替え & PWA**
   - 管理画面からの「平時モード ⇄ 災害モード」切り替え機能
   - オフラインでも過去の情報を閲覧できる Service Worker キャッシュ
6. **Phase 11: 大規模災害対応スケーリング & ボトルネック解消基盤 (完了)**
   - **閲覧時 DB 書き込みゼロ化**: 閲覧（GET/HEAD/OPTIONS）時の D1 `device_sessions` / `access_logs` 同期書き込みを完全に撤廃し、署名付き Cookie のみで端末セッションを維持。投稿・更新・削除時のみ D1 永続化（外部キー充足）。アクセス殺到時の D1 直列化ロックを完全防止。
   - **Cloudflare エッジキャッシュ完全化**: `CDN-Cache-Control: public, max-age=5, stale-while-revalidate=30` により、公開タイムライン読み取りを Cloudflare CDN エッジで 99% 吸収。ブラウザ側には `Cache-Control: no-cache` を返し、クライアント側ローカルストレージ（`localStorage['tossa_my_posts']`）で自身の投稿を即座にオーナー判定。
   - **写真・メディアストレージの Cloudflare R2 分離**: Base64 Data URL の D1 直保存を廃止し、R2 バケット（`IMAGES_BUCKET`）へ自動退避。API レスポンスと D1 容量を 99% 軽量化し、1年間のイミュータブルキャッシュ配信（`/api/images/:key`）を実現（R2 未設定環境では自動フォールバック）。
   - **Web Push チャンク分散配信**: Cloudflare Workers の同時サブリクエスト制限（50件）を超過しないよう、25件バッチで順次配信。失効エンドポイントの D1 削除もバッチ一括実行。
