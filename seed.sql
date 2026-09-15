-- seed.sql: tossa (咄嗟) Initial Seed Data

-- システム設定
INSERT OR REPLACE INTO system_settings (key, value, description) VALUES
('app_mode', 'normal', '稼働モード: normal (平時) / disaster (災害時)'),
('site_title', 'tossa｜生活情報板', 'サイトタイトル'),
('emergency_banner', '', '緊急アナウンス告知バー'),
('default_area', '熊本市', '標準表示エリア');

-- カテゴリ初期データ
-- 災害時カテゴリ (scope: 'disaster' または 'both')
INSERT OR REPLACE INTO categories (id, name, icon, color, scope, sort_order) VALUES
('water', '給水所', '💧', '#2563eb', 'disaster', 1),
('shelter', '避難所', '⛺', '#059669', 'disaster', 2),
('supplies', '物資・炊き出し', '🍙', '#d97706', 'disaster', 3),
('bath_toilet', '風呂・トイレ', '🚻', '#4f46e5', 'disaster', 4),
('store', '営業中店舗・薬局', '🏪', '#db2777', 'disaster', 5),
('hazard', '危険箇所・通行止', '⚠️', '#dc2626', 'disaster', 6),

-- 平時カテゴリ (scope: 'normal' または 'both')
('community', '地域情報・おしらせ', '📢', '#2563eb', 'both', 10),
('cafe_food', '飲食店・カフェ', '☕', '#8b5cf6', 'normal', 11),
('events', 'イベント・集会', '🎪', '#06b6d4', 'normal', 12),
('parenting', '子育て・公園', '👶', '#84cc16', 'normal', 13),
('mutual_aid', '助け合い・困りごと', '🤝', '#f97316', 'both', 14);

-- 初期管理者
INSERT OR REPLACE INTO users (id, username, display_name, role) VALUES
('user_admin_01', 'admin', 'システム管理者', 'admin');

