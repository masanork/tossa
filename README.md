# tossa（咄嗟）- 生活情報板 CMS

> **「咄嗟（とっさ）の機転で、即座に立ち上がる生活情報板」**  
> 平時は地域の生活・店舗・助け合いを共有し、有事（災害時）はワンクリックで避難・給水・ライフライン情報板へと切り替わる、Cloudflareネイティブの超軽量デュアルユースCMS。

---

## 🌟 特徴

1. **イマココナビの思想を継承したモバイルファーストUI**
   - 熊本地震の実績を基に設計された、片手・親指だけで操作できるピル/カテゴリフィルター
   - **「1タップ状況更新」マイクロアップデート機能**（「給水中」「混雑」「本日終了」など現場から即座に更新）
   - リスト一覧表示 & Leaflet 地図表示（ピン連動）
2. **圧倒的なスケーラビリティ & ゼロ・エグレスコスト**
   - **Cloudflare Workers + D1 (SQLite) + Workers Static Assets** による単一デプロイ構成
   - Cache API（10〜15秒）により、100万人規模のアクセス急増時でも D1 へのクエリを 98% 遮断
   - 転送量（Egress）無料の Cloudflare を活用し、急激なアクセスでも月額数ドル〜1万円台で安全稼働
3. **Passkey (WebAuthn) によるパスワードレス認証**
   - `@simplewebauthn` ベースの堅牢・安全な生体認証（Touch ID, Face ID, Windows Hello）
   - 自治体職員や現場モデレーターがパスワードやメールリンクなしで即座に管理権限を行使
4. **平時 ⇄ 災害時のデュアルユース切り替え**
   - 管理画面からワンクリックで「平時モード（カフェ・イベント・助け合い）」と「災害モード（給水・避難所・物資）」を切り替え可能
   - 全画面最上部の緊急告知アナウンスバーを即時配信

---

## 🛠 技術スタック

- **ランタイム**: Cloudflare Workers (TypeScript)
- **API フレームワーク**: Hono
- **データベース**: Cloudflare D1 (SQLite)
- **フロントエンド**: Svelte 5 (Runes) + Vite + Tailwind CSS v4
- **認証**: WebAuthn / Passkey (`@simplewebauthn/server` & `@simplewebauthn/browser`)
- **マップ**: Leaflet + OpenStreetMap

---

## 🚀 ローカル開発環境の起動

### 1. 依存関係のインストール

```bash
npm install
cd web && npm install && cd ..
```

### 2. ローカル D1 データベースの初期化 & シード投入

```bash
npm run db:reset:local
```

### 3. ビルド & 開発サーバー起動

```bash
# フロントエンドのビルド
npm run build

# Cloudflare Workers ローカル開発サーバー起動 (ポート 8787)
npm run dev
```

ブラウザで `http://localhost:8787` を開くと、tossa の画面が表示されます。

---

## 📦 Cloudflare への本番デプロイ

### 1. D1 データベースの作成

```bash
npx wrangler d1 create tossa-db
```

出力された `database_id` を `wrangler.jsonc` の `database_id` に設定します。また、本番環境のドメインに合わせて `RP_ID` と `EXPECTED_ORIGIN` を設定します。

### 2. 本番 D1 へのスキーマ・シード適用

```bash
npx wrangler d1 execute tossa-db --remote --file=./schema.sql
npx wrangler d1 execute tossa-db --remote --file=./seed.sql
```

### 3. デプロイ

```bash
npm run build
npx wrangler deploy
```

---

## 🔒 Passkey (WebAuthn) ログイン手順

1. 画面右上の **「管理 / 認証」** ボタンをクリック
2. ユーザー名 `admin` を入力
3. 初回は **「この端末を登録」** をクリックし、端末の Touch ID / Face ID / セキュリティキーで生体認証を登録
4. 次回以降は **「Passkey でログイン」** をクリックするだけで即座にログイン完了
5. ログイン後は、稼働モードの切り替え（平時 ⇄ 災害時）や緊急告知文の編集が可能です
