// src/types.ts: tossa (咄嗟) Type Definitions

export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;
  RP_NAME: string;
  RP_ID: string;
  EXPECTED_ORIGIN: string;
  JWT_SECRET?: string;
}

export type AppMode = 'normal' | 'disaster';
export type CategoryScope = 'normal' | 'disaster' | 'both';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  scope: CategoryScope;
  sort_order: number;
  created_at: string;
}

export interface Post {
  id: string;
  category_id: string;
  category_name?: string;
  category_icon?: string;
  category_color?: string;
  title: string;
  area: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  current_status: string;
  status_label: string;
  note: string | null;
  url: string | null;
  source_url?: string | null;
  image_url?: string | null;
  image_meta?: string; // JSON string
  verification_count?: number;
  last_verified_at?: string | null;
  attributes: string; // JSON string
  tags: string; // JSON array string e.g. '["給水", "Wi-Fi"]'
  is_verified: number; // 0 or 1
  reporter_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface StatusUpdate {
  id: string;
  post_id: string;
  status: string;
  status_label: string;
  note: string | null;
  reporter_ip_hash: string | null;
  created_at: string;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'moderator';
  current_challenge: string | null;
  created_at: string;
}

export interface Credential {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  device_type: string | null;
  backed_up: number;
  transports: string | null;
  created_at: string;
}

export interface SystemSetting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}
