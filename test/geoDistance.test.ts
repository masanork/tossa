// test/geoDistance.test.ts: Unit Tests for Distance & Compass Engine and Geolocation State
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateDistance,
  formatDistance,
  calculateBearing,
  getCardinalDirection,
  getRelativeAngle,
} from '../web/src/lib/geoDistance';
import { GeolocationManager } from '../web/src/lib/geolocation.svelte';

describe('geoDistance calculation & formatting', () => {
  describe('calculateDistance', () => {
    it('returns 0 for identical points', () => {
      expect(calculateDistance(35.6812, 139.7671, 35.6812, 139.7671)).toBe(0);
    });

    it('calculates accurate distance between Tokyo Station and Shinjuku Station (~6.2km)', () => {
      // Tokyo Station: 35.6812, 139.7671
      // Shinjuku Station: 35.6896, 139.7006
      const dist = calculateDistance(35.6812, 139.7671, 35.6896, 139.7006);
      expect(dist).toBeGreaterThan(6000);
      expect(dist).toBeLessThan(6500);
    });

    it('calculates very short distances (~50m)', () => {
      // 0.00045 degrees latitude is roughly 50 meters
      const dist = calculateDistance(35.6812, 139.7671, 35.68165, 139.7671);
      expect(dist).toBeGreaterThan(45);
      expect(dist).toBeLessThan(55);
    });
  });

  describe('formatDistance', () => {
    it('formats values under 1000m as integer meters', () => {
      expect(formatDistance(-10)).toBe('0m');
      expect(formatDistance(0)).toBe('0m');
      expect(formatDistance(45.2)).toBe('45m');
      expect(formatDistance(350)).toBe('350m');
      expect(formatDistance(999)).toBe('999m');
    });

    it('formats values between 1000m and 9999m with one decimal place km', () => {
      expect(formatDistance(1000)).toBe('1.0km');
      expect(formatDistance(1240)).toBe('1.2km');
      expect(formatDistance(9940)).toBe('9.9km');
    });

    it('formats values >= 10000m as rounded integer km', () => {
      expect(formatDistance(10000)).toBe('10km');
      expect(formatDistance(15499)).toBe('15km');
      expect(formatDistance(15600)).toBe('16km');
    });
  });

  describe('calculateBearing', () => {
    it('returns 0 for identical points', () => {
      expect(calculateBearing(35.0, 139.0, 35.0, 139.0)).toBe(0);
    });

    it('calculates North bearing (~0°)', () => {
      const bearing = calculateBearing(35.0, 139.0, 36.0, 139.0);
      expect(bearing).toBe(0);
    });

    it('calculates East bearing (~90°)', () => {
      const bearing = calculateBearing(0.0, 0.0, 0.0, 1.0);
      expect(bearing).toBe(90);
    });

    it('calculates South bearing (~180°)', () => {
      const bearing = calculateBearing(36.0, 139.0, 35.0, 139.0);
      expect(bearing).toBe(180);
    });

    it('calculates West bearing (~270°)', () => {
      const bearing = calculateBearing(0.0, 1.0, 0.0, 0.0);
      expect(bearing).toBe(270);
    });
  });

  describe('getCardinalDirection', () => {
    it('returns Japanese cardinal directions correctly', () => {
      expect(getCardinalDirection(0, 'ja')).toBe('北');
      expect(getCardinalDirection(45, 'ja')).toBe('北東');
      expect(getCardinalDirection(90, 'ja')).toBe('東');
      expect(getCardinalDirection(135, 'ja')).toBe('南東');
      expect(getCardinalDirection(180, 'ja')).toBe('南');
      expect(getCardinalDirection(225, 'ja')).toBe('南西');
      expect(getCardinalDirection(270, 'ja')).toBe('西');
      expect(getCardinalDirection(315, 'ja')).toBe('北西');
      expect(getCardinalDirection(355, 'ja')).toBe('北');
    });

    it('returns English cardinal directions correctly', () => {
      expect(getCardinalDirection(0, 'en')).toBe('N');
      expect(getCardinalDirection(45, 'en')).toBe('NE');
      expect(getCardinalDirection(90, 'en')).toBe('E');
      expect(getCardinalDirection(270, 'en')).toBe('W');
    });

    it('returns Easy Japanese cardinal directions correctly', () => {
      expect(getCardinalDirection(0, 'ja-easy')).toBe('きた');
      expect(getCardinalDirection(90, 'ja-easy')).toBe('ひがし');
      expect(getCardinalDirection(180, 'ja-easy')).toBe('みなみ');
      expect(getCardinalDirection(270, 'ja-easy')).toBe('にし');
    });
  });

  describe('getRelativeAngle', () => {
    it('returns targetBearing if deviceHeading is null or NaN', () => {
      expect(getRelativeAngle(90, null)).toBe(90);
      expect(getRelativeAngle(180, NaN)).toBe(180);
    });

    it('calculates angle relative to user facing direction', () => {
      // Facing East (90°), target is East (90°) -> 0° (ahead)
      expect(getRelativeAngle(90, 90)).toBe(0);

      // Facing North (0°), target is East (90°) -> 90° (right)
      expect(getRelativeAngle(90, 0)).toBe(90);

      // Facing West (270°), target is North (0°) -> 90° (right)
      expect(getRelativeAngle(0, 270)).toBe(90);

      // Facing East (90°), target is North (0°) -> 270° (left)
      expect(getRelativeAngle(0, 90)).toBe(270);
    });
  });
});

describe('GeolocationManager', () => {
  let storageMock: Record<string, string>;

  beforeEach(() => {
    storageMock = {};

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

    const mockNavigator = {
      geolocation: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
      permissions: {
        query: vi.fn().mockResolvedValue({ state: 'prompt' }),
      },
    };

    const mockWindow = {
      localStorage: mockLocalStorage,
      navigator: mockNavigator,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('localStorage', mockLocalStorage);
    vi.stubGlobal('navigator', mockNavigator);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores cached location from localStorage upon instantiation', () => {
    storageMock['tossa_last_pos'] = JSON.stringify({
      lat: 35.6812,
      lng: 139.7671,
      accuracy: 25,
      timestamp: 123456789,
    });
    storageMock['tossa_sort_distance'] = 'true';

    const manager = new GeolocationManager();
    expect(manager.currentLocation).not.toBeNull();
    expect(manager.currentLocation?.lat).toBe(35.6812);
    expect(manager.currentLocation?.lng).toBe(139.7671);
    expect(manager.currentLocation?.accuracy).toBe(25);
    expect(manager.sortByDistance).toBe(true);
  });

  it('calculates distance and bearing when location is available', () => {
    storageMock['tossa_last_pos'] = JSON.stringify({
      lat: 35.6812,
      lng: 139.7671,
      accuracy: 10,
    });

    const manager = new GeolocationManager();
    const dist = manager.getDistanceTo(35.6896, 139.7006);
    expect(dist).toBeGreaterThan(6000);

    const bearing = manager.getBearingTo(35.6896, 139.7006);
    expect(bearing).toBeGreaterThan(270);
    expect(bearing).toBeLessThan(330);
  });

  it('returns null for getDistanceTo and getBearingTo when location is not available or coords invalid', () => {
    const manager = new GeolocationManager();
    expect(manager.getDistanceTo(35.0, 139.0)).toBeNull();
    expect(manager.getBearingTo(35.0, 139.0)).toBeNull();

    manager.currentLocation = {
      lat: 35.0,
      lng: 139.0,
      accuracy: 10,
      heading: null,
      timestamp: Date.now(),
    };
    expect(manager.getDistanceTo(null, 139.0)).toBeNull();
    expect(manager.getDistanceTo(35.0, undefined)).toBeNull();
  });

  it('toggles sortByDistance correctly and persists to localStorage', async () => {
    storageMock['tossa_last_pos'] = JSON.stringify({
      lat: 35.6812,
      lng: 139.7671,
    });
    const manager = new GeolocationManager();
    expect(manager.sortByDistance).toBe(false);

    await manager.toggleSortByDistance();
    expect(manager.sortByDistance).toBe(true);
    expect(storageMock['tossa_sort_distance']).toBe('true');

    await manager.toggleSortByDistance();
    expect(manager.sortByDistance).toBe(false);
    expect(storageMock['tossa_sort_distance']).toBe('false');
  });
});
