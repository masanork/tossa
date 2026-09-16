// src/types.ts: tossa (咄嗟) Type Definitions

export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;
  RP_NAME: string;
  RP_ID: string;
  EXPECTED_ORIGIN: string;
  JWT_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
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
  tags: string; // JSON array string e.g. '["water", "wi-fi"]'
  is_verified: number; // 0 or 1
  author_id?: string | null;
  author_cookie_id?: string | null; // Cookie-identified user (without Passkey)
  is_owner?: boolean; // Cookie-based ownership flag (attached on query)
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
  role: 'admin' | 'moderator' | 'user';
  e2ee_public_key?: string | null;
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

// ================= Device Sessions & Access Logs =================

export interface DeviceSession {
  id: string;
  created_ip: string | null;
  created_ua: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface AccessLog {
  id: number;
  event_type: string;
  device_session_id: string | null;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

// ================= E2EE Messaging Types =================

export type ThreadType = 'inquiry' | 'admin_chat' | 'direct';

export interface Thread {
  id: string;
  title: string;
  type: ThreadType;
  post_id?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  post_title?: string | null;
  creator_name?: string | null;
  member_count?: number;
  my_encrypted_thread_key?: string;
  my_ephemeral_public_key?: string;
  last_message_at?: string;
}

export interface ThreadMember {
  id: string;
  thread_id: string;
  user_id: string;
  username?: string;
  display_name?: string;
  role: 'owner' | 'member';
  user_role?: 'admin' | 'moderator' | 'user';
  encrypted_thread_key: string;
  ephemeral_public_key: string;
  key_sender_id?: string | null;
  joined_at: string;
}

export interface EncryptedMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_username?: string;
  sender_display_name?: string;
  sender_role?: 'admin' | 'moderator' | 'user';
  ciphertext: string;
  iv: string;
  created_at: string;
}

// ================= Web Push Types =================

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id?: string | null;
  device_cookie_id?: string | null;
  area?: string | null;
  alert_types: string; // JSON string: ["emergency", "evacuation", "messages"]
  created_at: string;
  updated_at: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
}
