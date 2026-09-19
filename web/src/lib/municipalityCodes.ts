// web/src/lib/municipalityCodes.ts: Frontend Municipality Code Master & Search
export interface Municipality {
  code: string; // 5-6 digit Local Government Code
  name: string; // 市区町村名（例: 輪島市, 熊本市中央区）
  pref: string; // 都道府県名（例: 石川県, 熊本県）
  fullName: string; // 都道府県 + 市区町村（例: 石川県輪島市）
  lat: number;
  lng: number;
}

// Re-export POPULAR_MUNICIPALITIES
export const POPULAR_MUNICIPALITIES: Municipality[] = [
  // 北海道・東北
  { code: '011002', pref: '北海道', name: '札幌市', fullName: '北海道札幌市', lat: 43.0642, lng: 141.3469 },
  { code: '012025', pref: '北海道', name: '函館市', fullName: '北海道函館市', lat: 41.7687, lng: 140.7288 },
  { code: '012033', pref: '北海道', name: '小樽市', fullName: '北海道小樽市', lat: 43.1907, lng: 140.9947 },
  { code: '022012', pref: '青森県', name: '青森市', fullName: '青森県青森市', lat: 40.8244, lng: 140.7400 },
  { code: '022021', pref: '青森県', name: '弘前市', fullName: '青森県弘前市', lat: 40.6031, lng: 140.4642 },
  { code: '022039', pref: '青森県', name: '八戸市', fullName: '青森県八戸市', lat: 40.5123, lng: 141.4884 },
  { code: '032018', pref: '岩手県', name: '盛岡市', fullName: '岩手県盛岡市', lat: 39.7036, lng: 141.1527 },
  { code: '032026', pref: '岩手県', name: '宮古市', fullName: '岩手県宮古市', lat: 39.6414, lng: 141.9571 },
  { code: '032034', pref: '岩手県', name: '大船渡市', fullName: '岩手県大船渡市', lat: 39.0818, lng: 141.7086 },
  { code: '032051', pref: '岩手県', name: '花巻市', fullName: '岩手県花巻市', lat: 39.3892, lng: 141.1167 },
  { code: '032085', pref: '岩手県', name: '北上市', fullName: '岩手県北上市', lat: 39.2865, lng: 141.1133 },
  { code: '032093', pref: '岩手県', name: '久慈市', fullName: '岩手県久慈市', lat: 40.1906, lng: 141.7753 },
  { code: '032115', pref: '岩手県', name: '陸前高田市', fullName: '岩手県陸前高田市', lat: 39.0153, lng: 141.6294 },
  { code: '032131', pref: '岩手県', name: '釜石市', fullName: '岩手県釜石市', lat: 39.2760, lng: 141.8872 },
  { code: '041009', pref: '宮城県', name: '仙台市', fullName: '宮城県仙台市', lat: 38.2682, lng: 140.8694 },
  { code: '042021', pref: '宮城県', name: '石巻市', fullName: '宮城県石巻市', lat: 38.4344, lng: 141.3029 },
  { code: '042030', pref: '宮城県', name: '塩竈市', fullName: '宮城県塩竈市', lat: 38.3144, lng: 141.0219 },
  { code: '042056', pref: '宮城県', name: '気仙沼市', fullName: '宮城県気仙沼市', lat: 38.9080, lng: 141.5699 },
  { code: '042099', pref: '宮城県', name: '名取市', fullName: '宮城県名取市', lat: 38.1720, lng: 140.8931 },
  { code: '042111', pref: '宮城県', name: '多賀城市', fullName: '宮城県多賀城市', lat: 38.2936, lng: 141.0044 },
  { code: '052019', pref: '秋田県', name: '秋田市', fullName: '秋田県秋田市', lat: 39.7186, lng: 140.1024 },
  { code: '062014', pref: '山形県', name: '山形市', fullName: '山形県山形市', lat: 38.2404, lng: 140.3636 },
  { code: '062031', pref: '山形県', name: '鶴岡市', fullName: '山形県鶴岡市', lat: 38.7266, lng: 139.8247 },
  { code: '062049', pref: '山形県', name: '酒田市', fullName: '山形県酒田市', lat: 38.9144, lng: 139.8364 },
  { code: '072010', pref: '福島県', name: '福島市', fullName: '福島県福島市', lat: 37.7608, lng: 140.4748 },
  { code: '072028', pref: '福島県', name: '会津若松市', fullName: '福島県会津若松市', lat: 37.4947, lng: 139.9297 },
  { code: '072036', pref: '福島県', name: '郡山市', fullName: '福島県郡山市', lat: 37.3995, lng: 140.3887 },
  { code: '072044', pref: '福島県', name: 'いわき市', fullName: '福島県いわき市', lat: 37.0504, lng: 140.8877 },
  { code: '072117', pref: '福島県', name: '南相馬市', fullName: '福島県南相馬市', lat: 37.6403, lng: 140.9576 },

  // 関東
  { code: '082015', pref: '茨城県', name: '水戸市', fullName: '茨城県水戸市', lat: 36.3659, lng: 140.4712 },
  { code: '082031', pref: '茨城県', name: '土浦市', fullName: '茨城県土浦市', lat: 36.0792, lng: 140.2036 },
  { code: '082112', pref: '茨城県', name: 'つくば市', fullName: '茨城県つくば市', lat: 36.0835, lng: 140.0764 },
  { code: '092011', pref: '栃木県', name: '宇都宮市', fullName: '栃木県宇都宮市', lat: 36.5658, lng: 139.8836 },
  { code: '102016', pref: '群馬県', name: '前橋市', fullName: '群馬県前橋市', lat: 36.3907, lng: 139.0604 },
  { code: '102024', pref: '群馬県', name: '高崎市', fullName: '群馬県高崎市', lat: 36.3225, lng: 139.0033 },
  { code: '111007', pref: '埼玉県', name: 'さいたま市', fullName: '埼玉県さいたま市', lat: 35.8617, lng: 139.6455 },
  { code: '112011', pref: '埼玉県', name: '川越市', fullName: '埼玉県川越市', lat: 35.9251, lng: 139.4858 },
  { code: '112038', pref: '埼玉県', name: '川口市', fullName: '埼玉県川口市', lat: 35.8079, lng: 139.7241 },
  { code: '121002', pref: '千葉県', name: '千葉市', fullName: '千葉県千葉市', lat: 35.6074, lng: 140.1065 },
  { code: '122041', pref: '千葉県', name: '船橋市', fullName: '千葉県船橋市', lat: 35.6947, lng: 139.9825 },
  { code: '122076', pref: '千葉県', name: '松戸市', fullName: '千葉県松戸市', lat: 35.7878, lng: 139.9038 },
  { code: '122173', pref: '千葉県', name: '柏市', fullName: '千葉県柏市', lat: 35.8622, lng: 139.9709 },
  { code: '122271', pref: '千葉県', name: '浦安市', fullName: '千葉県浦安市', lat: 35.6531, lng: 139.8985 },
  { code: '131016', pref: '東京都', name: '千代田区', fullName: '東京都千代田区', lat: 35.6940, lng: 139.7536 },
  { code: '131024', pref: '東京都', name: '中央区', fullName: '東京都中央区', lat: 35.6707, lng: 139.7720 },
  { code: '131032', pref: '東京都', name: '港区', fullName: '東京都港区', lat: 35.6581, lng: 139.7514 },
  { code: '131041', pref: '東京都', name: '新宿区', fullName: '東京都新宿区', lat: 35.6938, lng: 139.7036 },
  { code: '131083', pref: '東京都', name: '江東区', fullName: '東京都江東区', lat: 35.6730, lng: 139.8173 },
  { code: '131130', pref: '東京都', name: '渋谷区', fullName: '東京都渋谷区', lat: 35.6628, lng: 139.7041 },
  { code: '131164', pref: '東京都', name: '豊島区', fullName: '東京都豊島区', lat: 35.7317, lng: 139.7153 },
  { code: '131237', pref: '東京都', name: '江戸川区', fullName: '東京都江戸川区', lat: 35.7066, lng: 139.8683 },
  { code: '132012', pref: '東京都', name: '八王子市', fullName: '東京都八王子市', lat: 35.6664, lng: 139.3138 },
  { code: '132021', pref: '東京都', name: '立川市', fullName: '東京都立川市', lat: 35.7140, lng: 139.4079 },
  { code: '132039', pref: '東京都', name: '武蔵野市', fullName: '東京都武蔵野市', lat: 35.7178, lng: 139.5663 },
  { code: '141003', pref: '神奈川県', name: '横浜市', fullName: '神奈川県横浜市', lat: 35.4437, lng: 139.6380 },
  { code: '141305', pref: '神奈川県', name: '川崎市', fullName: '神奈川県川崎市', lat: 35.5309, lng: 139.7030 },
  { code: '141500', pref: '神奈川県', name: '相模原市', fullName: '神奈川県相模原市', lat: 35.5714, lng: 139.3734 },
  { code: '142018', pref: '神奈川県', name: '横須賀市', fullName: '神奈川県横須賀市', lat: 35.2816, lng: 139.6722 },
  { code: '142034', pref: '神奈川県', name: '平塚市', fullName: '神奈川県平塚市', lat: 35.3276, lng: 139.3503 },
  { code: '142042', pref: '神奈川県', name: '鎌倉市', fullName: '神奈川県鎌倉市', lat: 35.3197, lng: 139.5467 },
  { code: '142051', pref: '神奈川県', name: '藤沢市', fullName: '神奈川県藤沢市', lat: 35.3392, lng: 139.4891 },
  { code: '142069', pref: '神奈川県', name: '小田原市', fullName: '神奈川県小田原市', lat: 35.2559, lng: 139.1597 },

  // 北陸・甲信越
  { code: '151009', pref: '新潟県', name: '新潟市', fullName: '新潟県新潟市', lat: 37.9161, lng: 139.0364 },
  { code: '152021', pref: '新潟県', name: '長岡市', fullName: '新潟県長岡市', lat: 37.4475, lng: 138.8517 },
  { code: '152056', pref: '新潟県', name: '柏崎市', fullName: '新潟県柏崎市', lat: 37.3694, lng: 138.5583 },
  { code: '152226', pref: '新潟県', name: '上越市', fullName: '新潟県上越市', lat: 37.1478, lng: 138.2361 },
  { code: '162019', pref: '富山県', name: '富山市', fullName: '富山県富山市', lat: 36.6953, lng: 137.2113 },
  { code: '162027', pref: '富山県', name: '高岡市', fullName: '富山県高岡市', lat: 36.7554, lng: 137.0189 },
  { code: '162051', pref: '富山県', name: '氷見市', fullName: '富山県氷見市', lat: 36.8569, lng: 136.9886 },
  { code: '172014', pref: '石川県', name: '金沢市', fullName: '石川県金沢市', lat: 36.5613, lng: 136.6562 },
  { code: '172022', pref: '石川県', name: '七尾市', fullName: '石川県七尾市', lat: 37.0422, lng: 136.9608 },
  { code: '172031', pref: '石川県', name: '小松市', fullName: '石川県小松市', lat: 36.4028, lng: 136.4503 },
  { code: '172049', pref: '石川県', name: '輪島市', fullName: '石川県輪島市', lat: 37.3906, lng: 136.8992 },
  { code: '172057', pref: '石川県', name: '珠洲市', fullName: '石川県珠洲市', lat: 37.4364, lng: 137.2605 },
  { code: '172065', pref: '石川県', name: '加賀市', fullName: '石川県加賀市', lat: 36.3047, lng: 136.3125 },
  { code: '172073', pref: '石川県', name: '羽咋市', fullName: '石川県羽咋市', lat: 36.8925, lng: 136.7869 },
  { code: '172111', pref: '石川県', name: '能美市', fullName: '石川県能美市', lat: 36.4447, lng: 136.5414 },
  { code: '173843', pref: '石川県', name: '志賀町', fullName: '石川県志賀町', lat: 37.0186, lng: 136.7583 },
  { code: '173860', pref: '石川県', name: '中能登町', fullName: '石川県中能登町', lat: 36.9744, lng: 136.8833 },
  { code: '174611', pref: '石川県', name: '穴水町', fullName: '石川県穴水町', lat: 37.2281, lng: 136.9042 },
  { code: '174637', pref: '石川県', name: '能登町', fullName: '石川県能登町', lat: 37.3375, lng: 137.1472 },
  { code: '182010', pref: '福井県', name: '福井市', fullName: '福井県福井市', lat: 36.0641, lng: 136.2195 },
  { code: '182028', pref: '福井県', name: '敦賀市', fullName: '福井県敦賀市', lat: 35.6453, lng: 136.0558 },
  { code: '192015', pref: '山梨県', name: '甲府市', fullName: '山梨県甲府市', lat: 35.6639, lng: 138.5683 },
  { code: '202011', pref: '長野県', name: '長野市', fullName: '長野県長野市', lat: 36.6513, lng: 138.1810 },
  { code: '202029', pref: '長野県', name: '松本市', fullName: '長野県松本市', lat: 36.2381, lng: 137.9720 },

  // 東海
  { code: '212016', pref: '岐阜県', name: '岐阜市', fullName: '岐阜県岐阜市', lat: 35.4233, lng: 136.7607 },
  { code: '212024', pref: '岐阜県', name: '大垣市', fullName: '岐阜県大垣市', lat: 35.3664, lng: 136.6178 },
  { code: '212032', pref: '岐阜県', name: '高山市', fullName: '岐阜県高山市', lat: 36.1461, lng: 137.2522 },
  { code: '221007', pref: '静岡県', name: '静岡市', fullName: '静岡県静岡市', lat: 34.9756, lng: 138.3828 },
  { code: '221309', pref: '静岡県', name: '浜松市', fullName: '静岡県浜松市', lat: 34.7108, lng: 137.7261 },
  { code: '222038', pref: '静岡県', name: '沼津市', fullName: '静岡県沼津市', lat: 35.1004, lng: 138.8600 },
  { code: '222054', pref: '静岡県', name: '熱海市', fullName: '静岡県熱海市', lat: 35.0963, lng: 139.0717 },
  { code: '222062', pref: '静岡県', name: '三島市', fullName: '静岡県三島市', lat: 35.1189, lng: 138.9189 },
  { code: '222101', pref: '静岡県', name: '富士市', fullName: '静岡県富士市', lat: 35.1614, lng: 138.6764 },
  { code: '231002', pref: '愛知県', name: '名古屋市', fullName: '愛知県名古屋市', lat: 35.1815, lng: 136.9066 },
  { code: '232017', pref: '愛知県', name: '豊橋市', fullName: '愛知県豊橋市', lat: 34.7692, lng: 137.3914 },
  { code: '232025', pref: '愛知県', name: '岡崎市', fullName: '愛知県岡崎市', lat: 34.9550, lng: 137.1728 },
  { code: '232033', pref: '愛知県', name: '一宮市', fullName: '愛知県一宮市', lat: 35.3039, lng: 136.7958 },
  { code: '232114', pref: '愛知県', name: '豊田市', fullName: '愛知県豊田市', lat: 35.0840, lng: 137.1558 },
  { code: '242012', pref: '三重県', name: '津市', fullName: '三重県津市', lat: 34.7186, lng: 136.5056 },
  { code: '242021', pref: '三重県', name: '四日市市', fullName: '三重県四日市市', lat: 34.9650, lng: 136.6247 },
  { code: '242039', pref: '三重県', name: '伊勢市', fullName: '三重県伊勢市', lat: 34.4875, lng: 136.7092 },

  // 関西
  { code: '252018', pref: '滋賀県', name: '大津市', fullName: '滋賀県大津市', lat: 35.0178, lng: 135.8547 },
  { code: '252026', pref: '滋賀県', name: '彦根市', fullName: '滋賀県彦根市', lat: 35.2744, lng: 136.2597 },
  { code: '261009', pref: '京都府', name: '京都市', fullName: '京都府京都市', lat: 35.0116, lng: 135.7681 },
  { code: '262013', pref: '京都府', name: '福知山市', fullName: '京都府福知山市', lat: 35.2975, lng: 135.1278 },
  { code: '262021', pref: '京都府', name: '舞鶴市', fullName: '京都府舞鶴市', lat: 35.4744, lng: 135.3853 },
  { code: '271004', pref: '大阪府', name: '大阪市', fullName: '大阪府大阪市', lat: 34.6937, lng: 135.5023 },
  { code: '271403', pref: '大阪府', name: '堺市', fullName: '大阪府堺市', lat: 34.5733, lng: 135.4831 },
  { code: '272027', pref: '大阪府', name: '岸和田市', fullName: '大阪府岸和田市', lat: 34.4597, lng: 135.3719 },
  { code: '272035', pref: '大阪府', name: '豊中市', fullName: '大阪府豊中市', lat: 34.7814, lng: 135.4697 },
  { code: '272078', pref: '大阪府', name: '高槻市', fullName: '大阪府高槻市', lat: 34.8458, lng: 135.6175 },
  { code: '272272', pref: '大阪府', name: '東大阪市', fullName: '大阪府東大阪市', lat: 34.6725, lng: 135.6008 },
  { code: '281000', pref: '兵庫県', name: '神戸市', fullName: '兵庫県神戸市', lat: 34.6901, lng: 135.1955 },
  { code: '282014', pref: '兵庫県', name: '姫路市', fullName: '兵庫県姫路市', lat: 34.8153, lng: 134.6853 },
  { code: '282022', pref: '兵庫県', name: '尼崎市', fullName: '兵庫県尼崎市', lat: 34.7175, lng: 135.4056 },
  { code: '282031', pref: '兵庫県', name: '明石市', fullName: '兵庫県明石市', lat: 34.6431, lng: 134.9972 },
  { code: '282049', pref: '兵庫県', name: '西宮市', fullName: '兵庫県西宮市', lat: 34.7378, lng: 135.3414 },
  { code: '282065', pref: '兵庫県', name: '芦屋市', fullName: '兵庫県芦屋市', lat: 34.7297, lng: 135.3047 },
  { code: '282138', pref: '兵庫県', name: '豊岡市', fullName: '兵庫県豊岡市', lat: 35.5447, lng: 134.8211 },
  { code: '282294', pref: '兵庫県', name: '淡路市', fullName: '兵庫県淡路市', lat: 34.5492, lng: 134.9125 },
  { code: '292010', pref: '奈良県', name: '奈良市', fullName: '奈良県奈良市', lat: 34.6851, lng: 135.8048 },
  { code: '302015', pref: '和歌山県', name: '和歌山市', fullName: '和歌山県和歌山市', lat: 34.2305, lng: 135.1708 },
  { code: '302066', pref: '和歌山県', name: '田辺市', fullName: '和歌山県田辺市', lat: 33.7294, lng: 135.3775 },
  { code: '302091', pref: '和歌山県', name: '新宮市', fullName: '和歌山県新宮市', lat: 33.7247, lng: 135.9928 },
  { code: '304212', pref: '和歌山県', name: '那智勝浦町', fullName: '和歌山県那智勝浦町', lat: 33.6264, lng: 135.9406 },

  // 中国・四国
  { code: '312011', pref: '鳥取県', name: '鳥取市', fullName: '鳥取県鳥取市', lat: 35.5011, lng: 134.2351 },
  { code: '312029', pref: '鳥取県', name: '米子市', fullName: '鳥取県米子市', lat: 35.4281, lng: 133.3308 },
  { code: '322016', pref: '島根県', name: '松江市', fullName: '島根県松江市', lat: 35.4722, lng: 133.0506 },
  { code: '322032', pref: '島根県', name: '出雲市', fullName: '島根県出雲市', lat: 35.3672, lng: 132.7553 },
  { code: '331007', pref: '岡山県', name: '岡山市', fullName: '岡山県岡山市', lat: 34.6551, lng: 133.9195 },
  { code: '332020', pref: '岡山県', name: '倉敷市', fullName: '岡山県倉敷市', lat: 34.5850, lng: 133.7719 },
  { code: '341002', pref: '広島県', name: '広島市', fullName: '広島県広島市', lat: 34.3853, lng: 132.4553 },
  { code: '342025', pref: '広島県', name: '呉市', fullName: '広島県呉市', lat: 34.2492, lng: 132.5653 },
  { code: '342076', pref: '広島県', name: '福山市', fullName: '広島県福山市', lat: 34.4858, lng: 133.3628 },
  { code: '352012', pref: '山口県', name: '下関市', fullName: '山口県下関市', lat: 33.9578, lng: 130.9414 },
  { code: '352039', pref: '山口県', name: '山口市', fullName: '山口県山口市', lat: 34.1783, lng: 131.4736 },
  { code: '362018', pref: '徳島県', name: '徳島市', fullName: '徳島県徳島市', lat: 34.0703, lng: 134.5547 },
  { code: '362026', pref: '徳島県', name: '鳴門市', fullName: '徳島県鳴門市', lat: 34.1764, lng: 134.6111 },
  { code: '362034', pref: '徳島県', name: '小松島市', fullName: '徳島県小松島市', lat: 34.0089, lng: 134.5886 },
  { code: '362042', pref: '徳島県', name: '阿南市', fullName: '徳島県阿南市', lat: 33.9167, lng: 134.6558 },
  { code: '372013', pref: '香川県', name: '高松市', fullName: '香川県高松市', lat: 34.3428, lng: 134.0467 },
  { code: '372021', pref: '香川県', name: '丸亀市', fullName: '香川県丸亀市', lat: 34.2886, lng: 133.7972 },
  { code: '382019', pref: '愛媛県', name: '松山市', fullName: '愛媛県松山市', lat: 33.8392, lng: 132.7656 },
  { code: '382027', pref: '愛媛県', name: '今治市', fullName: '愛媛県今治市', lat: 34.0664, lng: 132.9978 },
  { code: '382035', pref: '愛媛県', name: '宇和島市', fullName: '愛媛県宇和島市', lat: 33.2233, lng: 132.5606 },
  { code: '392014', pref: '高知県', name: '高知市', fullName: '高知県高知市', lat: 33.5597, lng: 133.5311 },
  { code: '392022', pref: '高知県', name: '室戸市', fullName: '高知県室戸市', lat: 33.2878, lng: 134.1506 },
  { code: '392031', pref: '高知県', name: '安芸市', fullName: '高知県安芸市', lat: 33.5042, lng: 133.9042 },
  { code: '392049', pref: '高知県', name: '南国市', fullName: '高知県南国市', lat: 33.5786, lng: 133.6428 },
  { code: '392057', pref: '高知県', name: '土佐市', fullName: '高知県土佐市', lat: 33.4975, lng: 133.4244 },
  { code: '392065', pref: '高知県', name: '須崎市', fullName: '高知県須崎市', lat: 33.3931, lng: 133.2928 },
  { code: '392090', pref: '高知県', name: '宿毛市', fullName: '高知県宿毛市', lat: 32.9406, lng: 132.7275 },
  { code: '392103', pref: '高知県', name: '土佐清水市', fullName: '高知県土佐清水市', lat: 32.7828, lng: 132.9550 },
  { code: '392111', pref: '高知県', name: '四万十市', fullName: '高知県四万十市', lat: 32.9917, lng: 132.9339 },
  { code: '392120', pref: '高知県', name: '香南市', fullName: '高知県香南市', lat: 33.5572, lng: 133.6933 },
  { code: '392138', pref: '高知県', name: '香美市', fullName: '高知県香美市', lat: 33.6133, lng: 133.6811 },
  { code: '394017', pref: '高知県', name: '黒潮町', fullName: '高知県黒潮町', lat: 33.0489, lng: 133.0478 },

  // 九州・沖縄
  { code: '401307', pref: '福岡県', name: '福岡市', fullName: '福岡県福岡市', lat: 33.5904, lng: 130.4017 },
  { code: '401005', pref: '福岡県', name: '北九州市', fullName: '福岡県北九州市', lat: 33.8835, lng: 130.8752 },
  { code: '402036', pref: '福岡県', name: '久留米市', fullName: '福岡県久留米市', lat: 33.3192, lng: 130.5083 },
  { code: '402109', pref: '福岡県', name: '八女市', fullName: '福岡県八女市', lat: 33.2108, lng: 130.5583 },
  { code: '402257', pref: '福岡県', name: '朝倉市', fullName: '福岡県朝倉市', lat: 33.4219, lng: 130.6694 },
  { code: '412015', pref: '佐賀県', name: '佐賀市', fullName: '佐賀県佐賀市', lat: 33.2635, lng: 130.3008 },
  { code: '412023', pref: '佐賀県', name: '唐津市', fullName: '佐賀県唐津市', lat: 33.4503, lng: 129.9692 },
  { code: '422011', pref: '長崎県', name: '長崎市', fullName: '長崎県長崎市', lat: 32.7503, lng: 129.8777 },
  { code: '422029', pref: '長崎県', name: '佐世保市', fullName: '長崎県佐世保市', lat: 33.1797, lng: 129.7153 },
  { code: '422037', pref: '長崎県', name: '島原市', fullName: '長崎県島原市', lat: 32.7892, lng: 130.3703 },
  { code: '431001', pref: '熊本県', name: '熊本市', fullName: '熊本県熊本市', lat: 32.7898, lng: 130.7417 },
  { code: '431010', pref: '熊本県', name: '熊本市中央区', fullName: '熊本県熊本市中央区', lat: 32.8031, lng: 130.7082 },
  { code: '431028', pref: '熊本県', name: '熊本市東区', fullName: '熊本県熊本市東区', lat: 32.8125, lng: 130.7241 },
  { code: '431036', pref: '熊本県', name: '熊本市西区', fullName: '熊本県熊本市西区', lat: 32.7850, lng: 130.6800 },
  { code: '431044', pref: '熊本県', name: '熊本市南区', fullName: '熊本県熊本市南区', lat: 32.7300, lng: 130.6800 },
  { code: '431052', pref: '熊本県', name: '熊本市北区', fullName: '熊本県熊本市北区', lat: 32.8500, lng: 130.7100 },
  { code: '432024', pref: '熊本県', name: '八代市', fullName: '熊本県八代市', lat: 32.5075, lng: 130.6019 },
  { code: '432032', pref: '熊本県', name: '人吉市', fullName: '熊本県人吉市', lat: 32.2108, lng: 130.7558 },
  { code: '432083', pref: '熊本県', name: '玉名市', fullName: '熊本県玉名市', lat: 32.9306, lng: 130.5606 },
  { code: '432148', pref: '熊本県', name: '阿蘇市', fullName: '熊本県阿蘇市', lat: 32.9381, lng: 131.1214 },
  { code: '434434', pref: '熊本県', name: '益城町', fullName: '熊本県益城町', lat: 32.7958, lng: 130.8175 },
  { code: '434329', pref: '熊本県', name: '南阿蘇村', fullName: '熊本県南阿蘇村', lat: 32.8250, lng: 131.0250 },
  { code: '434426', pref: '熊本県', name: '西原村', fullName: '熊本県西原村', lat: 32.8361, lng: 130.9000 },
  { code: '442011', pref: '大分県', name: '大分市', fullName: '大分県大分市', lat: 33.2381, lng: 131.6125 },
  { code: '442020', pref: '大分県', name: '別府市', fullName: '大分県別府市', lat: 33.2844, lng: 131.4911 },
  { code: '442046', pref: '大分県', name: '日田市', fullName: '大分県日田市', lat: 33.3214, lng: 130.9408 },
  { code: '452017', pref: '宮崎県', name: '宮崎市', fullName: '宮崎県宮崎市', lat: 31.9077, lng: 131.4202 },
  { code: '452025', pref: '宮崎県', name: '都城市', fullName: '宮崎県都城市', lat: 31.7197, lng: 131.0617 },
  { code: '452033', pref: '宮崎県', name: '延岡市', fullName: '宮崎県延岡市', lat: 32.5822, lng: 131.6647 },
  { code: '452041', pref: '宮崎県', name: '日南市', fullName: '宮崎県日南市', lat: 31.6014, lng: 131.3789 },
  { code: '452050', pref: '宮崎県', name: '小林市', fullName: '宮崎県小林市', lat: 31.9936, lng: 130.9728 },
  { code: '452068', pref: '宮崎県', name: '日向市', fullName: '宮崎県日向市', lat: 32.4267, lng: 131.6247 },
  { code: '462012', pref: '鹿児島県', name: '鹿児島市', fullName: '鹿児島県鹿児島市', lat: 31.5966, lng: 130.5571 },
  { code: '462039', pref: '鹿児島県', name: '鹿屋市', fullName: '鹿児島県鹿屋市', lat: 31.3783, lng: 130.8522 },
  { code: '462047', pref: '鹿児島県', name: '枕崎市', fullName: '鹿児島県枕崎市', lat: 31.2725, lng: 130.2975 },
  { code: '462152', pref: '鹿児島県', name: '指宿市', fullName: '鹿児島県指宿市', lat: 31.2358, lng: 130.6406 },
  { code: '462209', pref: '鹿児島県', name: '南さつま市', fullName: '鹿児島県南さつま市', lat: 31.4172, lng: 130.3208 },
  { code: '462225', pref: '鹿児島県', name: '奄美市', fullName: '鹿児島県奄美市', lat: 28.3769, lng: 129.4950 },
  { code: '472018', pref: '沖縄県', name: '那覇市', fullName: '沖縄県那覇市', lat: 26.2124, lng: 127.6809 },
  { code: '472051', pref: '沖縄県', name: '宜野湾市', fullName: '沖縄県宜野湾市', lat: 26.2814, lng: 127.7783 },
  { code: '472077', pref: '沖縄県', name: '石垣市', fullName: '沖縄県石垣市', lat: 24.3447, lng: 124.1572 },
  { code: '472085', pref: '沖縄県', name: '浦添市', fullName: '沖縄県浦添市', lat: 26.2464, lng: 127.7208 },
  { code: '472093', pref: '沖縄県', name: '名護市', fullName: '沖縄県名護市', lat: 26.5919, lng: 127.9772 },
  { code: '472115', pref: '沖縄県', name: '沖縄市', fullName: '沖縄県沖縄市', lat: 26.3344, lng: 127.8056 },
  { code: '472131', pref: '沖縄県', name: 'うるま市', fullName: '沖縄県うるま市', lat: 26.3769, lng: 127.8597 },
  { code: '472140', pref: '沖縄県', name: '宮古島市', fullName: '沖縄県宮古島市', lat: 24.8056, lng: 125.2811 },
];

/**
 * Searches local municipalities, with fallback to GSI AddressSearch API
 */
export async function searchMunicipalities(
  query: string,
  limit = 8
): Promise<Municipality[]> {
  const q = query.trim();
  if (!q) return [];

  // Local match first
  const localMatches = POPULAR_MUNICIPALITIES.filter((m) => {
    return (
      m.name.includes(q) ||
      m.fullName.includes(q) ||
      m.code.startsWith(q) ||
      m.pref.includes(q)
    );
  }).slice(0, limit);

  if (localMatches.length >= 3) {
    return localMatches;
  }

  // Fallback to GSI AddressSearch API
  try {
    const res = await fetch(
      `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`
    );
    if (res.ok) {
      const data: any = await res.json();
      if (Array.isArray(data)) {
        const remoteResults: Municipality[] = [];
        for (const item of data) {
          const props = item.properties || {};
          const geom = item.geometry || {};
          const title: string = props.title || '';
          const addressCode: string = props.addressCode || '';
          const coords = geom.coordinates;

          if (title && coords && coords.length >= 2) {
            const match = title.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)(.+)/);
            const pref = (match && match[1]) ? match[1] : '';
            const name = (match && match[2]) ? match[2] : title;
            const code = addressCode.length >= 5 ? addressCode : `muni-${name}`;

            if (!localMatches.some((m) => m.name === name || m.fullName === title)) {
              remoteResults.push({
                code,
                name,
                pref,
                fullName: title,
                lng: coords[0],
                lat: coords[1],
              });
            }
          }
        }
        return [...localMatches, ...remoteResults].slice(0, limit);
      }
    }
  } catch {
    // ignore
  }

  return localMatches;
}
