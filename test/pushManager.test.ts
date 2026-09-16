// test/pushManager.test.ts: Unit Tests for PushNotificationManager & Base64URL Conversion
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PushNotificationManager,
  urlBase64ToUint8Array,
} from '../web/src/lib/pushManager.svelte';
import * as api from '../web/src/lib/api';

describe('urlBase64ToUint8Array helper', () => {
  it('correctly converts base64url string to Uint8Array', () => {
    // 0x01, 0x02, 0x03, 0xfa, 0xfb, 0xfc
    // Base64: AQID+vv8, Base64URL: AQID-vv8
    const base64url = 'AQID-vv8';
    const bytes = urlBase64ToUint8Array(base64url);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 250, 251, 252]);
  });

  it('handles strings requiring padding restoration', () => {
    const raw = 'dGVzdA'; // "test" in base64 without "=="
    const bytes = urlBase64ToUint8Array(raw);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe('test');
  });
});

describe('PushNotificationManager', () => {
  let storageMock: Record<string, string>;
  let originalWindow: any;
  let originalNavigator: any;
  let originalNotification: any;

  beforeEach(() => {
    storageMock = {};
    originalWindow = (globalThis as any).window;
    originalNavigator = (globalThis as any).navigator;
    originalNotification = (globalThis as any).Notification;

    const mockLocalStorage = {
      getItem: (key: string) => storageMock[key] ?? null,
      setItem: (key: string, val: string) => {
        storageMock[key] = val;
      },
      removeItem: (key: string) => {
        delete storageMock[key];
      },
      clear: () => {
        storageMock = {};
      },
      length: 0,
      key: () => null,
    };

    const mockNotification = {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };
    (globalThis as any).Notification = mockNotification;
    (globalThis as any).window = {
      PushManager: {},
      Notification: mockNotification,
      localStorage: mockLocalStorage,
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: {
              getSubscription: vi.fn().mockResolvedValue(null),
              subscribe: vi.fn().mockResolvedValue({
                endpoint: 'https://push.example.com/test',
                toJSON: () => ({
                  endpoint: 'https://push.example.com/test',
                  keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
                }),
                unsubscribe: vi.fn().mockResolvedValue(true),
              }),
            },
          }),
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    (globalThis as any).Notification = originalNotification;
    vi.restoreAllMocks();
  });

  it('detects feature support correctly', () => {
    const manager = new PushNotificationManager();
    expect(manager.supported).toBe(true);
    expect(manager.permission).toBe('granted');
  });

  it('updates area and alert preferences and persists in localStorage', () => {
    const manager = new PushNotificationManager();
    manager.setArea('西区');
    expect(manager.area).toBe('西区');
    expect(storageMock['tossa_push_area']).toBe('西区');

    manager.setAlertTypes(['emergency', 'status']);
    expect(manager.alertTypes).toEqual(['emergency', 'status']);
    expect(JSON.parse(storageMock['tossa_push_alert_types'])).toEqual([
      'emergency',
      'status',
    ]);
  });

  it('subscribes successfully and handles API registration', async () => {
    vi.spyOn(api, 'fetchVapidPublicKey').mockResolvedValue({
      success: true,
      publicKey: 'aGVsbG8td29ybGQtMTIzNDU2Nzg5MC10ZXN0LWtleS1zdHJpbmctdmFsaWQ',
    });
    vi.spyOn(api, 'subscribePushApi').mockResolvedValue({
      success: true,
      id: 'sub_123',
    });

    const manager = new PushNotificationManager();
    manager.setArea('中央区');

    const result = await manager.subscribe('test-token');
    expect(result).toBe(true);
    expect(manager.isSubscribed).toBe(true);
    expect(manager.currentSubscription).not.toBeNull();
  });

  it('unsubscribes successfully and removes subscription', async () => {
    vi.spyOn(api, 'unsubscribePushApi').mockResolvedValue({ success: true });

    const manager = new PushNotificationManager();
    manager.currentSubscription = {
      endpoint: 'https://push.example.com/test',
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as any;
    manager.isSubscribed = true;

    const result = await manager.unsubscribe();
    expect(result).toBe(true);
    expect(manager.isSubscribed).toBe(false);
    expect(manager.currentSubscription).toBeNull();
  });

  it('sends test notification via API', async () => {
    const testSpy = vi
      .spyOn(api, 'sendTestPushApi')
      .mockResolvedValue({ success: true });

    const manager = new PushNotificationManager();
    const result = await manager.sendTest();
    expect(result).toBe(true);
    expect(testSpy).toHaveBeenCalled();
  });
});
