-- seed.sql: tossa Initial Seed Data
-- システム設定
INSERT OR REPLACE INTO system_settings (key, value, description) VALUES
('site_title', 'tossa', 'サイトタイトル'),
('emergency_banner', '', '緊急アナウンス告知バー（必要な場合のみ設定）'),
('default_area', '', '対象エリア・自治体名（管理者が任意設定、未設定時は全域）');
-- ※ 初期管理者はデプロイ後に最初にPasskey登録した利用者に自動付与されます（First-come Admin）
