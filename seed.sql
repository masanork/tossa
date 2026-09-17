-- seed.sql: tossa Initial Seed Data
-- システム設定
INSERT OR REPLACE INTO system_settings (key, value, description) VALUES
('site_title', 'tossa', 'サイトタイトル'),
('emergency_banner', '', '緊急アナウンス告知バー（必要な場合のみ設定）'),
('default_area', '', '対象エリア・自治体名（管理者が任意設定、未設定時は全域）');

-- 標準カテゴリの初期シード
INSERT OR IGNORE INTO categories (id, name, icon, color, scope, sort_order) VALUES
('shelter', '避難所', '⛺', '#2563eb', 'disaster', 1),
('water', '給水所', '💧', '#0284c7', 'disaster', 2),
('food', '食料・炊き出し', '🍙', '#d97706', 'disaster', 3),
('safety', '安否確認', '🦺', '#16a34a', 'disaster', 4),
('restroom', 'トイレ', '🚻', '#0d9488', 'both', 5),
('charging', '充電スポット', '🔋', '#7c3aed', 'both', 6),
('bath', '入浴・シャワー', '♨️', '#4f46e5', 'both', 7),
('supplies', '物資・支援物資', '📦', '#ea580c', 'both', 8),
('store', '店舗・日用品', '🏪', '#059669', 'normal', 9),
('general', '一般・その他', '📌', '#64748b', 'both', 10);
-- ※ 初期管理者はデプロイ後に最初にPasskey登録した利用者に自動付与されます（First-come Admin）

