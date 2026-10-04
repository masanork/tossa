export interface DeviceStorageStatus {
  persistence: 'persistent' | 'temporary' | 'unsupported' | 'unknown';
  usageBytes?: number;
  quotaBytes?: number;
}

function bytes(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export async function readDeviceStorageStatus(): Promise<DeviceStorageStatus> {
  const storage = navigator.storage;
  let persistence: DeviceStorageStatus['persistence'] =
    typeof storage?.persisted === 'function' ? 'unknown' : 'unsupported';
  if (typeof storage?.persisted === 'function') {
    try {
      persistence = (await storage.persisted()) ? 'persistent' : 'temporary';
    } catch {
      // A failed diagnostic must never disable saving an unsent report.
    }
  }
  let estimate: StorageEstimate = {};
  if (typeof storage?.estimate === 'function') {
    try {
      estimate = await storage.estimate();
    } catch {
      // Storage estimates are optional and may be unavailable in private mode.
    }
  }
  return {
    persistence,
    usageBytes: bytes(estimate.usage),
    quotaBytes: bytes(estimate.quota),
  };
}

export async function requestPersistentDeviceStorage(): Promise<boolean> {
  if (typeof navigator.storage?.persist !== 'function') return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
