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

-- 災害事象テーブル（複数災害の独立管理・発災自動判定）
CREATE TABLE IF NOT EXISTS disasters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,           -- 災害名 (例: 令和6年能登半島地震, 奥能登豪雨 等)
    disaster_type TEXT NOT NULL,  -- earthquake, flood, landslide, tsunami, storm, volcano, snow, other
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')), -- active: 発災中, archived: 収束・記録
    designated_at TEXT NOT NULL DEFAULT (datetime('now')), -- 発災・指定日時
    areas TEXT NOT NULL DEFAULT '[]', -- JSON配列: 対象自治体・都道府県 (DisasterArea[])
    banner_message TEXT,          -- 災害固有の緊急呼びかけメッセージ
    note TEXT,                    -- 備考・詳細
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_disasters_status ON disasters(status, designated_at DESC);

-- 投稿テーブル
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    category_id TEXT DEFAULT 'general',
    title TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '', -- 市区町村・地区名（任意。空文字可）
    address TEXT,                 -- 詳細住所・施設名
    lat REAL,                     -- 緯度
    lng REAL,                     -- 経度
    current_status TEXT NOT NULL, -- 識別コード (available, crowded, closed, etc.)
    status_label TEXT NOT NULL,   -- 日本語表示ラベル (給水中, 配布終了, 混雑, 営業中 等)
    note TEXT,                    -- 補足・備考
    url TEXT,                     -- 関連リンク・SNS URL
    source_url TEXT,              -- 情報源URL（自治体HP、公式X、ニュース等）
    image_url TEXT,               -- 投稿写真（最適化WebP/JPEG Data URLまたは画像URL）
    image_meta TEXT NOT NULL DEFAULT '{}', -- JSON: EXIF（撮影日時・GPS・機種）およびC2PA真正性メタデータ
    verification_count INTEGER NOT NULL DEFAULT 0, -- コミュニティ確認済件数
    last_verified_at TEXT,        -- 最終確認時刻
    attributes TEXT NOT NULL DEFAULT '{}', -- JSON: カテゴリ別任意属性 ({"supplies": ["水", "タオル"], "hours": "9:00-17:00"})
    tags TEXT NOT NULL DEFAULT '[]',       -- JSON配列: 自発的成長タグ (["給水", "ポリタンク持参", "Wi-Fi"])
    is_verified INTEGER NOT NULL DEFAULT 0, -- 1: 自治体・公式確認済
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL, -- 投稿者ユーザーID（Passkey登録ユーザー）
    author_cookie_id TEXT REFERENCES device_sessions(id), -- Cookie識別ユーザー（Passkey未登録）
    reporter_name TEXT,           -- 投稿者表示名（任意）
    disaster_id TEXT REFERENCES disasters(id) ON DELETE SET NULL, -- 関連災害事象ID
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_area ON posts(area);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_author_cookie ON posts(author_cookie_id);
CREATE INDEX IF NOT EXISTS idx_posts_disaster ON posts(disaster_id);
CREATE INDEX IF NOT EXISTS idx_posts_updated ON posts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(current_status);

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

-- 情報の正確性・現地確認（コミュニティによる信頼性検証ログ）
CREATE TABLE IF NOT EXISTS post_verifications (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reporter_ip_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_post_verifications_post ON post_verifications(post_id, created_at DESC);

-- 管理者・モデレーター・一般ユーザー
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'moderator', 'user')),
    e2ee_public_key TEXT,         -- E2EE ECDH (P-256) 公開鍵 (JWK JSON)
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

-- ================= E2EE Messaging (Threads, Members, Messages) =================

-- E2EE メッセージング: スレッドテーブル
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('inquiry', 'admin_chat', 'direct')),
    post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_post ON threads(post_id);

-- E2EE メッセージング: スレッド参加メンバー & エンベロープ暗号化スレッド鍵
CREATE TABLE IF NOT EXISTS thread_members (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_thread_key TEXT NOT NULL, -- 対象ユーザーのECDH公開鍵で暗号化されたスレッド鍵
    ephemeral_public_key TEXT NOT NULL, -- 暗号化時に使用されたエフェメラル公開鍵 (JWK JSON)
    key_sender_id TEXT REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_members_user ON thread_members(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_members_thread ON thread_members(thread_id);

-- E2EE メッセージング: 暗号化メッセージ
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id),
    ciphertext TEXT NOT NULL,           -- スレッド共通鍵 (AES-256-GCM) で暗号化されたメッセージ本文 (Base64)
    iv TEXT NOT NULL,                   -- 初期化ベクトル (Base64)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at ASC);

-- ================= Device Sessions & Access Logs =================

-- 端末セッション（Cookieベースの匿名識別）
CREATE TABLE IF NOT EXISTS device_sessions (
    id TEXT PRIMARY KEY,              -- ランダムな識別子（Cookieに保存）
    created_ip TEXT,                  -- 発行時IPアドレス（開示請求対応）
    created_ua TEXT,                  -- 発行時UserAgent
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_created ON device_sessions(created_at DESC);

-- アクセスログ（開示請求・不正調査用）
CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,         -- 'cookie_issued', 'passkey_register', 'passkey_login', 'post_created', 'post_updated', 'post_deleted'
    device_session_id TEXT REFERENCES device_sessions(id),
    user_id TEXT REFERENCES users(id),
    ip_address TEXT,
    user_agent TEXT,
    metadata TEXT,                    -- JSON: 追加コンテキスト（投稿IDなど）
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_access_logs_device ON access_logs(device_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_event ON access_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_created ON access_logs(created_at DESC);

-- 端末セッションとPasskeyユーザーのN:N紐付け
CREATE TABLE IF NOT EXISTS device_user_links (
    device_session_id TEXT NOT NULL REFERENCES device_sessions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    linked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (device_session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_device_user_links_device ON device_user_links(device_session_id);
CREATE INDEX IF NOT EXISTS idx_device_user_links_user ON device_user_links(user_id);

-- ================= Web Push Subscriptions =================

-- Web Push 購読情報（PWA・ブラウザ緊急通知）
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    device_cookie_id TEXT REFERENCES device_sessions(id) ON DELETE SET NULL,
    area TEXT,                        -- 通知希望地域 (空欄の場合は全地域)
    alert_types TEXT NOT NULL DEFAULT '["emergency", "evacuation", "messages"]', -- JSON配列
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_area ON push_subscriptions(area);
CREATE INDEX IF NOT EXISTS idx_push_subs_device ON push_subscriptions(device_cookie_id);

