// test/peerPosts.test.ts: Unit tests for Offline Peer Posts Persistence and Merge logic
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPeerPosts,
  savePeerPost,
  removePeerPost,
  clearPeerPosts,
  isPeerPostId,
  mergePostsWithPeer,
} from '../web/src/lib/peerPosts';
import type { Post } from '../web/src/lib/types';

const basePost: Post = {
  id: 'peer-post-1',
  category_id: 'water',
  category_name: '給水',
  category_icon: '💧',
  category_color: '#3b82f6',
  title: '町民体育館 給水開始',
  area: '本町',
  address: '本町2-1',
  lat: 35.68,
  lng: 139.75,
  current_status: 'open',
  status_label: '配給中',
  note: '1人2Lまで',
  url: null,
  source_url: null,
  attributes: '{}',
  is_verified: 0,
  created_at: '2026-09-16T12:00:00.000Z',
  updated_at: '2026-09-16T12:00:00.000Z',
};

// Polyfill localStorage for node test environment if needed
class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string) {
    return this.store[key] || null;
  }
  setItem(key: string, val: string) {
    this.store[key] = val;
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = new MockLocalStorage();
}

describe('peerPosts', () => {
  beforeEach(() => {
    clearPeerPosts();
  });

  describe('savePeerPost & getPeerPosts', () => {
    it('saves a new peer post and marks as new', () => {
      const res = savePeerPost(basePost);
      expect(res.saved).toBe(true);
      expect(res.isNew).toBe(true);

      const list = getPeerPosts();
      expect(list.length).toBe(1);
      expect(list[0]?.id).toBe('peer-post-1');
      expect(isPeerPostId('peer-post-1')).toBe(true);
    });

    it('updates existing peer post when newer updated_at is provided', () => {
      savePeerPost(basePost);

      const updatedPost: Post = {
        ...basePost,
        status_label: '配給終了',
        updated_at: '2026-09-16T14:00:00.000Z',
      };

      const res = savePeerPost(updatedPost);
      expect(res.saved).toBe(true);
      expect(res.isNew).toBe(false);

      const list = getPeerPosts();
      expect(list.length).toBe(1);
      expect(list[0]?.status_label).toBe('配給終了');
    });

    it('ignores incoming post if local version is newer', () => {
      const newerPost: Post = {
        ...basePost,
        status_label: '新情報',
        updated_at: '2026-09-16T15:00:00.000Z',
      };
      savePeerPost(newerPost);

      const olderPost: Post = {
        ...basePost,
        status_label: '古い情報',
        updated_at: '2026-09-16T10:00:00.000Z',
      };

      const res = savePeerPost(olderPost);
      expect(res.saved).toBe(false);

      const list = getPeerPosts();
      expect(list[0]?.status_label).toBe('新情報');
    });
  });

  describe('removePeerPost & clearPeerPosts', () => {
    it('removes specific post by id', () => {
      savePeerPost(basePost);
      savePeerPost({ ...basePost, id: 'peer-post-2' });
      expect(getPeerPosts().length).toBe(2);

      removePeerPost('peer-post-1');
      const list = getPeerPosts();
      expect(list.length).toBe(1);
      expect(list[0]?.id).toBe('peer-post-2');
      expect(isPeerPostId('peer-post-1')).toBe(false);
    });

    it('clears all posts', () => {
      savePeerPost(basePost);
      expect(getPeerPosts().length).toBe(1);
      clearPeerPosts();
      expect(getPeerPosts().length).toBe(0);
    });
  });

  describe('mergePostsWithPeer', () => {
    it('merges non-overlapping server posts and peer posts', () => {
      const serverPosts: Post[] = [
        {
          ...basePost,
          id: 'server-1',
          created_at: '2026-09-16T09:00:00.000Z',
          updated_at: '2026-09-16T09:00:00.000Z',
        },
      ];
      const peerPosts: Post[] = [
        {
          ...basePost,
          id: 'peer-1',
          created_at: '2026-09-16T10:00:00.000Z',
          updated_at: '2026-09-16T10:00:00.000Z',
        },
      ];

      const merged = mergePostsWithPeer(serverPosts, peerPosts);
      expect(merged.length).toBe(2);
      expect(merged[0]?.id).toBe('peer-1'); // newer first
      expect(merged[1]?.id).toBe('server-1');
    });

    it('deduplicates matching IDs by keeping the latest update', () => {
      const serverPost: Post = {
        ...basePost,
        id: 'shared-id',
        status_label: 'サーバー初期状態',
        updated_at: '2026-09-16T10:00:00.000Z',
      };
      const peerPost: Post = {
        ...basePost,
        id: 'shared-id',
        status_label: '現地ピア更新状態',
        updated_at: '2026-09-16T11:30:00.000Z',
      };

      const merged = mergePostsWithPeer([serverPost], [peerPost]);
      expect(merged.length).toBe(1);
      expect(merged[0]?.status_label).toBe('現地ピア更新状態');
    });
  });
});
