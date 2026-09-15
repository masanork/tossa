-- seed.sql: tossa (咄嗟) Initial Seed Data

-- システム設定
INSERT OR REPLACE INTO system_settings (key, value, description) VALUES
('app_mode', 'disaster', '稼働モード: normal (平時) / disaster (災害時)'),
('site_title', 'tossa｜生活情報板', 'サイトタイトル'),
('emergency_banner', '現在【災害モード】で稼働中です。給水・物資・避難所の最新状況を共有してください。', '緊急アナウンス告知バー'),
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

-- サンプル初期投稿データ（熊本地震モデル）
INSERT OR REPLACE INTO posts (id, category_id, title, area, address, lat, lng, current_status, status_label, note, attributes, is_verified) VALUES
(
    'post-sample-01',
    'water',
    '熊本市立白川小学校 臨時給水所',
    '中央区',
    '熊本市中央区新屋敷1-9-1',
    32.8015,
    130.7188,
    'available',
    '給水受付中',
    '持参のポリタンク・ペットボトルに給水可能。現在待機列は約5分程度です。',
    '{"water_limit": "1人20Lまで", "container_required": true, "hours": "8:00 - 18:00"}',
    1
),
(
    'post-sample-02',
    'shelter',
    '熊本市総合体育館',
    '中央区',
    '熊本市中央区出水2-7-1',
    32.7876,
    130.7352,
    'crowded',
    '受入中（混雑）',
    '大アリーナは満室に近いです。小体育館および駐車場スペースに空きあり。ペット同伴エリア開設中。',
    '{"capacity": "混雑 (80%)", "pet_allowed": true, "power_station": true}',
    1
),
(
    'post-sample-03',
    'supplies',
    '水前寺共済会館前 物資配布所',
    '中央区',
    '熊本市中央区水前寺1-7-3',
    32.7932,
    130.7301,
    'available',
    '配布中',
    '飲料水、ウェットティッシュ、紙おむつ（M/L）、粉ミルク配布中。',
    '{"items": ["飲料水", "紙おむつ", "ウェットティッシュ", "衛生用品"], "remain": "余裕あり"}',
    0
),
(
    'post-sample-04',
    'bath_toilet',
    '天然温泉 つる乃湯 熊本店',
    '東区',
    '熊本市東区下南部3-13-53',
    32.8251,
    130.7602,
    'available',
    '無料開放中',
    '被災者向けに内風呂を無料開放しています。シャンプー・石鹸持参推奨。混雑時は入場制限の可能性あり。',
    '{"fee": "無料", "towel_provided": false, "hours": "12:00 - 21:00"}',
    1
),
(
    'post-sample-05',
    'store',
    'ゆめマート 水前寺駅前店',
    '中央区',
    '熊本市中央区水前寺1-1-1',
    32.7944,
    130.7289,
    'open',
    '時短営業中',
    '食料品・パン・おにぎり・簡易トイレ等店頭販売中。現金決済のみ対応（通信障害のため）。',
    '{"payment": "現金のみ", "hours": "10:00 - 16:00", "battery_charging": false}',
    0
),
(
    'post-sample-06',
    'hazard',
    '白川沿い 市道冠水・地割れ注意',
    '中央区',
    '熊本市中央区大江3丁目付近',
    32.8055,
    130.7240,
    'danger',
    '通行止め',
    '路面崩落およびマンホール隆起のため車両通行不可。歩行者も迂回してください。',
    '{"restriction": "全面通行止め", "danger_type": "路面段差・液状化"}',
    1
);

-- 初期ステータス履歴
INSERT OR REPLACE INTO status_updates (id, post_id, status, status_label, note, reporter_ip_hash) VALUES
('update-sample-01', 'post-sample-01', 'available', '給水受付中', '給水車到着しました。列短いです。', 'hash_seed_1'),
('update-sample-02', 'post-sample-02', 'crowded', '受入中（混雑）', '大アリーナはほぼ定員に達しました。', 'hash_seed_2'),
('update-sample-03', 'post-sample-05', 'open', '時短営業中', 'おにぎり・パンの入荷あり。店頭で購入できます。', 'hash_seed_3');

-- 初期管理者
INSERT OR REPLACE INTO users (id, username, display_name, role) VALUES
('user_admin_01', 'admin', 'システム管理者', 'admin');
