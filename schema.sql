-- schema.sql: tossa (咄嗟) Cloudflare D1 Schema

-- カテゴリテーブル（平時・災害時・両用）
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,           -- 絵文字またはアイコン名 (💧, ⛺, ☕, 🏪 等)
    color TEXT NOT NULL,          -- HEXカラーコード (#3b82f6 等)
    scope TEXT NOT NULL CHECK(scope IN ('normal', 'disaster', 'both')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 投稿テーブル
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    title TEXT NOT NULL,
    area TEXT NOT NULL,           -- 市区町村・地区名 (熊本市中央区, 東区 等)
    address TEXT,                 -- 詳細住所・施設名
    lat REAL,                     -- 緯度
    lng REAL,                     -- 経度
    current_status TEXT NOT NULL, -- 識別コード (available, crowded, closed, etc.)
    status_label TEXT NOT NULL,   -- 日本語表示ラベル (給水中, 配布終了, 混雑, 営業中 等)
    note TEXT,                    -- 補足・備考
    url TEXT,                     -- 関連リンク・SNS URL
    attributes TEXT NOT NULL DEFAULT '{}', -- JSON: カテゴリ別任意属性 ({"supplies": ["水", "タオル"], "hours": "9:00-17:00"})
    tags TEXT NOT NULL DEFAULT '[]',       -- JSON配列: 自発的成長タグ (["給水", "ポリタンク持参", "Wi-Fi"])
    is_verified INTEGER NOT NULL DEFAULT 0, -- 1: 自治体・公式確認済
    reporter_name TEXT,           -- 投稿者表示名（任意）
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_area ON posts(area);
CREATE INDEX IF NOT EXISTS idx_posts_updated ON posts(updated_at DESC);

-- ステータス更新履歴（マイクロアップデート追跡・通報対応）
CREATE TABLE IF NOT EXISTS status_updates (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    status_label TEXT NOT NULL,
    note TEXT,
    reporter_ip_hash TEXT,        -- スパム検知用IPハッシュ（個人情報は保存しない）
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_status_updates_post ON status_updates(post_id, created_at DESC);

-- 管理者・モデレーターユーザー
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'moderator')),
    current_challenge TEXT,       -- WebAuthn チャレンジ一時保管用
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Passkey (WebAuthn) 認証情報
CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,          -- Base64URL credentialId
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,     -- Base64URL または Hex 形式の公開鍵
    counter INTEGER NOT NULL DEFAULT 0,
    device_type TEXT,             -- 'single_device' | 'multi_device'
    backed_up INTEGER NOT NULL DEFAULT 0,
    transports TEXT,              -- JSON: ["internal", "hybrid", "usb"]
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

-- システム設定（平時・災害時モード切り替え等）
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
