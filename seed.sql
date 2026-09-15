-- seed.sql: tossa (咄嗟) Initial Seed Data

-- システム設定（モード分離は撤廃し、常時稼働の単一生活情報板とする）
INSERT OR REPLACE INTO system_settings (key, value, description) VALUES
('site_title', 'tossa｜生活情報板', 'サイトタイトル'),
('emergency_banner', '', '緊急アナウンス告知バー（必要な場合のみ設定）'),
('default_area', '熊本市', '標準表示エリア');

-- カテゴリ初期データ（常時全カテゴリを開放）
INSERT OR REPLACE INTO categories (id, name, icon, color, scope, sort_order) VALUES
('water', '給水・水回り', '💧', '#2563eb', 'both', 1),
('shelter', '避難所・公共施設', '⛺', '#059669', 'both', 2),
('supplies', '物資・食料', '🍙', '#d97706', 'both', 3),
('bath_toilet', '風呂・トイレ', '🚻', '#4f46e5', 'both', 4),
('store', '営業店舗・薬局', '🏪', '#db2777', 'both', 5),
('hazard', '危険箇所・通行止', '⚠️', '#dc2626', 'both', 6),
('cafe_food', '飲食店・カフェ', '☕', '#8b5cf6', 'both', 7),
('community', '地域情報・おしらせ', '📢', '#0284c7', 'both', 8),
('events', 'イベント・集会', '🎪', '#06b6d4', 'both', 9),
('parenting', '子育て・公園', '👶', '#84cc16', 'both', 10),
('mutual_aid', '助け合い・困りごと', '🤝', '#f97316', 'both', 11);

-- 初期管理者
INSERT OR REPLACE INTO users (id, username, display_name, role) VALUES
('user_admin_01', 'admin', 'システム管理者', 'admin');
