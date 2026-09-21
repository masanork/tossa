// web/src/lib/pushManager.svelte.ts: Svelte 5 Reactive Web Push Subscription & Alert Manager
import {
  fetchVapidPublicKey,
  subscribePushApi,
  unsubscribePushApi,
  sendTestPushApi,
} from './api';

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export class PushNotificationManager {
  supported = $state<boolean>(false);
  permission = $state<NotificationPermission>('default');
  isSubscribed = $state<boolean>(false);
  isLoading = $state<boolean>(false);
  errorMessage = $state<string | null>(null);
  currentSubscription = $state<PushSubscription | null>(null);

  area = $state<string>('');
  alertTypes = $state<string[]>(['emergency', 'evacuation', 'messages']);

  constructor() {
    if (typeof window !== 'undefined') {
      this.supported =
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window;

      if ('Notification' in window) {
        this.permission = Notification.permission;
      }

      const savedArea = window.localStorage?.getItem('tossa_push_area');
      if (savedArea) {
        this.area = savedArea;
      }

      const savedTypes = window.localStorage?.getItem('tossa_push_alert_types');
      if (savedTypes) {
        try {
          this.alertTypes = JSON.parse(savedTypes);
        } catch {
          // ignore
        }
      }

      if (this.supported) {
        void this.checkExistingSubscription();
      }
    }
  }

  async checkExistingSubscription(): Promise<void> {
    try {
      if (!this.supported) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      this.currentSubscription = sub;
      this.isSubscribed = !!sub;
      if ('Notification' in window) {
        this.permission = Notification.permission;
      }
    } catch (err: any) {
      console.warn('[pushManager] check subscription error:', err);
    }
  }

  async subscribe(token?: string | null): Promise<boolean> {
    if (!this.supported) {
      this.errorMessage =
        'Notifications are not supported in this browser.';
      return false;
    }

    this.isLoading = true;
    this.errorMessage = null;

    try {
      // 1. Request browser notification permission
      const permission = await Notification.requestPermission();
      this.permission = permission;

      if (permission !== 'granted') {
        this.errorMessage = 'Notification permission was denied or dismissed.';
        this.isLoading = false;
        return false;
      }

      // 2. Fetch public VAPID key
      const vapidRes = await fetchVapidPublicKey();
      if (!vapidRes.success || !vapidRes.publicKey) {
        throw new Error(
          vapidRes.error || 'Failed to retrieve VAPID public key'
        );
      }

      const applicationServerKey = urlBase64ToUint8Array(vapidRes.publicKey);

      // 3. Register push subscription with browser push service
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as any,
        });
      }

      this.currentSubscription = sub;

      // 4. Save subscription to backend D1 database
      const saveRes = await subscribePushApi(
        sub.toJSON(),
        this.area || undefined,
        this.alertTypes,
        token
      );

      if (!saveRes.success) {
        throw new Error(saveRes.error || 'Failed to persist push subscription');
      }

      this.isSubscribed = true;
      this.isLoading = false;
      return true;
    } catch (err: any) {
      this.errorMessage = err.message || 'Failed to enable push notifications';
      this.isLoading = false;
      return false;
    }
  }

  async unsubscribe(): Promise<boolean> {
    this.isLoading = true;
    this.errorMessage = null;

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await unsubscribePushApi(endpoint);
      }

      this.currentSubscription = null;
      this.isSubscribed = false;
      this.isLoading = false;
      return true;
    } catch (err: any) {
      this.errorMessage = err.message || 'Failed to unsubscribe';
      this.isLoading = false;
      return false;
    }
  }

  async sendTest(token?: string | null): Promise<boolean> {
    this.errorMessage = null;
    try {
      const sub = this.currentSubscription
        ? this.currentSubscription.toJSON()
        : undefined;
      const res = await sendTestPushApi(sub, token);
      if (!res.success) {
        this.errorMessage = res.error || 'Test notification failed';
        return false;
      }
      return true;
    } catch (err: any) {
      this.errorMessage = err.message || 'Failed to send test push';
      return false;
    }
  }

  setArea(area: string, token?: string | null): void {
    this.area = area;
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('tossa_push_area', area);
    }
    // If already subscribed, update preference on server
    if (this.isSubscribed && this.currentSubscription) {
      subscribePushApi(
        this.currentSubscription.toJSON(),
        this.area || undefined,
        this.alertTypes,
        token
      ).catch((err) => console.warn('[pushManager] update area failed:', err));
    }
  }

  setAlertTypes(types: string[], token?: string | null): void {
    this.alertTypes = types;
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(
        'tossa_push_alert_types',
        JSON.stringify(types)
      );
    }
    // If already subscribed, update preference on server
    if (this.isSubscribed && this.currentSubscription) {
      subscribePushApi(
        this.currentSubscription.toJSON(),
        this.area || undefined,
        this.alertTypes,
        token
      ).catch((err) => console.warn('[pushManager] update types failed:', err));
    }
  }
}

export const pushManager = new PushNotificationManager();
