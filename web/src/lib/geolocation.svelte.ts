// web/src/lib/geolocation.svelte.ts: Svelte 5 Reactive User Geolocation & Compass Manager

import { calculateDistance, calculateBearing } from './geoDistance';

export interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  timestamp: number;
}

export interface WaypointTarget {
  id: string;
  title: string;
  area: string;
  lat: number;
  lng: number;
  statusLabel?: string | null;
  address?: string | null;
}

export class GeolocationManager {
  currentLocation = $state<UserLocation | null>(null);
  isLocating = $state<boolean>(false);
  error = $state<string | null>(null);
  deviceHeading = $state<number | null>(null);
  permissionState = $state<'prompt' | 'granted' | 'denied' | 'unsupported'>(
    'prompt'
  );
  sortByDistance = $state<boolean>(false);
  activeWaypoint = $state<WaypointTarget | null>(null);

  private watchId: number | null = null;
  private orientationListener: ((e: DeviceOrientationEvent) => void) | null =
    null;

  constructor() {
    if (typeof window !== 'undefined') {
      // 1. Restore last known location from localStorage for instant offline startup
      try {
        const cached = localStorage.getItem('tossa_last_pos');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (
            parsed &&
            typeof parsed.lat === 'number' &&
            typeof parsed.lng === 'number'
          ) {
            this.currentLocation = {
              lat: parsed.lat,
              lng: parsed.lng,
              accuracy: parsed.accuracy || 100,
              heading: null,
              timestamp: parsed.timestamp || Date.now(),
            };
          }
        }

        const savedSort = localStorage.getItem('tossa_sort_distance');
        if (savedSort === 'true') {
          this.sortByDistance = true;
        }
      } catch {
        // ignore storage errors
      }

      // Check permission if query API is available
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions
          .query({ name: 'geolocation' as PermissionName })
          .then((result) => {
            if (result.state === 'granted') {
              this.permissionState = 'granted';
            } else if (result.state === 'denied') {
              this.permissionState = 'denied';
            }
          })
          .catch(() => {
            // ignore
          });
      }
    }
  }

  /**
   * Requests the current GPS location once or triggers watch.
   */
  async requestLocation(): Promise<UserLocation | null> {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      this.permissionState = 'unsupported';
      this.error = 'お使いの端末は位置情報取得に対応していません';
      return null;
    }

    this.isLocating = true;
    this.error = null;

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.isLocating = false;
          this.permissionState = 'granted';
          const loc: UserLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
            heading: pos.coords.heading ?? null,
            timestamp: pos.timestamp,
          };
          this.currentLocation = loc;

          try {
            localStorage.setItem(
              'tossa_last_pos',
              JSON.stringify({
                lat: loc.lat,
                lng: loc.lng,
                accuracy: loc.accuracy,
                timestamp: loc.timestamp,
              })
            );
          } catch {
            // ignore storage errors
          }

          this.startOrientationTracking();
          this.startWatching();
          resolve(loc);
        },
        (err) => {
          this.isLocating = false;
          if (err.code === err.PERMISSION_DENIED) {
            this.permissionState = 'denied';
            this.error =
              '位置情報の利用が拒否されました。設定で許可してください。';
          } else if (err.code === err.TIMEOUT) {
            this.error = '位置情報の取得がタイムアウトしました。';
          } else {
            this.error = '位置情報を取得できませんでした。';
          }
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 10000,
        }
      );
    });
  }

  /**
   * Continuously tracks user location with battery-efficient options.
   */
  startWatching(): void {
    if (
      typeof window === 'undefined' ||
      !navigator.geolocation ||
      this.watchId !== null
    ) {
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.currentLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          heading: pos.coords.heading ?? null,
          timestamp: pos.timestamp,
        };
      },
      () => {
        // Silently keep last known location on temporary watch errors
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      }
    );
  }

  stopWatching(): void {
    if (
      this.watchId !== null &&
      typeof navigator !== 'undefined' &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * Tracks compass orientation angle for rotating direction needles.
   */
  startOrientationTracking(): void {
    if (typeof window === 'undefined' || this.orientationListener !== null)
      return;

    this.orientationListener = (e: DeviceOrientationEvent) => {
      // iOS webkitCompassHeading is relative to magnetic North (0-360 clockwise)
      if ((e as any).webkitCompassHeading) {
        this.deviceHeading = Math.round((e as any).webkitCompassHeading);
      } else if (e.alpha !== null && e.absolute) {
        // Android DeviceOrientation absolute
        this.deviceHeading = Math.round(360 - e.alpha);
      }
    };

    const win = window as any;
    if ('ondeviceorientationabsolute' in win) {
      win.addEventListener(
        'deviceorientationabsolute',
        this.orientationListener,
        true
      );
    } else if (win.DeviceOrientationEvent) {
      win.addEventListener('deviceorientation', this.orientationListener, true);
    }
  }

  stopOrientationTracking(): void {
    if (this.orientationListener && typeof window !== 'undefined') {
      const win = window as any;
      win.removeEventListener(
        'deviceorientationabsolute',
        this.orientationListener,
        true
      );
      win.removeEventListener(
        'deviceorientation',
        this.orientationListener,
        true
      );
      this.orientationListener = null;
    }
  }

  /**
   * Toggles distance sorting mode.
   * Automatically prompts for location if not yet acquired.
   */
  async toggleSortByDistance(): Promise<void> {
    if (this.sortByDistance) {
      this.sortByDistance = false;
      try {
        localStorage.setItem('tossa_sort_distance', 'false');
      } catch {
        // ignore
      }
      return;
    }

    if (!this.currentLocation) {
      const loc = await this.requestLocation();
      if (loc) {
        this.sortByDistance = true;
        try {
          localStorage.setItem('tossa_sort_distance', 'true');
        } catch {
          // ignore
        }
      }
    } else {
      this.sortByDistance = true;
      try {
        localStorage.setItem('tossa_sort_distance', 'true');
      } catch {
        // ignore
      }
    }
  }

  /**
   * Calculates distance from user to target coordinates in meters.
   */
  getDistanceTo(
    targetLat: number | null | undefined,
    targetLng: number | null | undefined
  ): number | null {
    if (
      !this.currentLocation ||
      targetLat === null ||
      targetLat === undefined ||
      targetLng === null ||
      targetLng === undefined
    ) {
      return null;
    }
    return calculateDistance(
      this.currentLocation.lat,
      this.currentLocation.lng,
      targetLat,
      targetLng
    );
  }

  /**
   * Calculates bearing from user to target in degrees [0, 360).
   */
  getBearingTo(
    targetLat: number | null | undefined,
    targetLng: number | null | undefined
  ): number | null {
    if (
      !this.currentLocation ||
      targetLat === null ||
      targetLat === undefined ||
      targetLng === null ||
      targetLng === undefined
    ) {
      return null;
    }
    return calculateBearing(
      this.currentLocation.lat,
      this.currentLocation.lng,
      targetLat,
      targetLng
    );
  }

  /**
   * Starts waypoint navigation toward the given target.
   * Immediately activates GPS tracking and device compass.
   */
  startNavigation(target: WaypointTarget): void {
    this.activeWaypoint = target;
    this.startOrientationTracking();
    this.startWatching();
    if (!this.currentLocation) {
      void this.requestLocation();
    }
  }

  /**
   * Stops active waypoint navigation.
   */
  stopNavigation(): void {
    this.activeWaypoint = null;
    if (!this.sortByDistance) {
      this.stopWatching();
      this.stopOrientationTracking();
    }
  }

  /**
   * Calculates distance to active waypoint in meters.
   */
  get waypointDistance(): number | null {
    if (!this.activeWaypoint) return null;
    return this.getDistanceTo(this.activeWaypoint.lat, this.activeWaypoint.lng);
  }

  /**
   * Calculates bearing to active waypoint in degrees.
   */
  get waypointBearing(): number | null {
    if (!this.activeWaypoint) return null;
    return this.getBearingTo(this.activeWaypoint.lat, this.activeWaypoint.lng);
  }

  /**
   * True if user has arrived within 30 meters of active waypoint.
   */
  get isWaypointArrived(): boolean {
    const d = this.waypointDistance;
    return d !== null && d <= 30;
  }
}

export const geolocationManager = new GeolocationManager();
