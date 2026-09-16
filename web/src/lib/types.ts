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
  source_url?: string | null;
  image_url?: string | null;
  image_meta?: string; // JSON string
  verification_count?: number;
  last_verified_at?: string | null;
  attributes: string; // JSON string
  tags?: string; // JSON array string
  is_verified: number;
  author_id?: string | null;
  author_cookie_id?: string | null; // Cookie-identified user (without Passkey)
  is_owner?: boolean; // Ownership verified by server via cookie matching
  reporter_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImageMeta {
  exif?: {
    dateTimeOriginal?: string;
    make?: string;
    model?: string;
    latitude?: number;
    longitude?: number;
  };
  c2pa?: {
    hasC2pa: boolean;
    isSigned?: boolean;
    claimGenerator?: string;
    format?: string;
    issuer?: string;
    time?: string;
  };
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
  role: 'admin' | 'moderator' | 'user';
  e2ee_public_key?: string | null;
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

export interface DecryptedMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_username?: string;
  sender_display_name?: string;
  sender_role?: 'admin' | 'moderator' | 'user';
  text: string;
  created_at: string;
  isMine: boolean;
}
