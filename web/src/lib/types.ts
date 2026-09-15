// web/src/lib/types.ts: Frontend Type Definitions

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  scope?: string;
  sort_order: number;
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
  attributes: string; // JSON string
  tags?: string; // JSON array string
  is_verified: number;
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
  created_at: string;
}

export interface SystemSettings {
  site_title?: string;
  emergency_banner?: string;
  default_area?: string;
  [key: string]: string | undefined;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'moderator';
}
