import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readDeviceStorageStatus,
  requestPersistentDeviceStorage,
} from '../web/src/lib/deviceStorage';

afterEach(() => vi.unstubAllGlobals());

describe('Device storage diagnostics', () => {
  it('reports permission and origin usage without claiming the queue occupies all storage', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => true,
        estimate: async () => ({ usage: 1024, quota: 4096 }),
      },
    });
    expect(await readDeviceStorageStatus()).toEqual({
      persistence: 'persistent',
      usageBytes: 1024,
      quotaBytes: 4096,
    });
  });

  it('handles unsupported, refused and failed persistence requests', async () => {
    vi.stubGlobal('navigator', {});
    expect((await readDeviceStorageStatus()).persistence).toBe('unsupported');
    expect(await requestPersistentDeviceStorage()).toBe(false);
    vi.stubGlobal('navigator', {
      storage: {
        persist: async () => false,
        persisted: async () => {
          throw new Error('blocked');
        },
        estimate: async () => {
          throw new Error('blocked');
        },
      },
    });
    expect((await readDeviceStorageStatus()).persistence).toBe('unknown');
    expect(await requestPersistentDeviceStorage()).toBe(false);
  });

  it('does not display invalid usage or quota estimates', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => false,
        estimate: async () => ({ usage: -1, quota: Infinity }),
      },
    });
    expect(await readDeviceStorageStatus()).toEqual({
      persistence: 'temporary',
      usageBytes: undefined,
      quotaBytes: undefined,
    });
  });
});
