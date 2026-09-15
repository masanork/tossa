-- seed.sql: tossa (咄嗟) Initial Seed Data

-- システム設定（モード分離は撤廃し、常時稼働の単一生活情報板とする）
INSERT OR REPLACE INTO system_settings (key, value, description) VALUES
('site_title', 'tossa｜生活情報板', 'サイトタイトル'),
('emergency_banner', '', '緊急アナウンス告知バー（必要な場合のみ設定）'),
('default_area', '', '対象エリア・自治体名（管理者が任意設定、未設定時は全域）');

-- 初期管理者
INSERT OR REPLACE INTO users (id, username, display_name, role) VALUES
('user_admin_01', 'admin', 'システム管理者', 'admin');
