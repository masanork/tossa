import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';
import { runCapacityMaintenance } from '../src/services/capacity';
import { refreshPublicFeedSnapshot } from '../src/services/feedSnapshot';
import { performDatabaseBackup } from '../src/services/backup';
import { sendErrorAlert } from '../src/services/alert';
import type { Bindings } from '../src/types';

vi.mock('../src/services/capacity', () => ({
  runCapacityMaintenance: vi.fn(),
}));

vi.mock('../src/services/feedSnapshot', () => ({
  refreshPublicFeedSnapshot: vi.fn(),
}));

vi.mock('../src/services/backup', () => ({
  performDatabaseBackup: vi.fn(),
}));

vi.mock('../src/services/alert', () => ({
  sendErrorAlert: vi.fn(),
}));

describe('Worker Scheduled Handler', () => {
  let env: Bindings;
  let ctx: ExecutionContext;
  let waitUntilPromises: Promise<any>[];
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    waitUntilPromises = [];
    env = {
      ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/dummy',
    } as unknown as Bindings;
    ctx = {
      waitUntil: (promise: Promise<any>) => {
        waitUntilPromises.push(promise);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('runs maintenance on */10 * * * * successfully', async () => {
    vi.mocked(runCapacityMaintenance).mockResolvedValue();
    vi.mocked(refreshPublicFeedSnapshot).mockResolvedValue();
    vi.mocked(performDatabaseBackup).mockResolvedValue({ success: true });

    await worker.scheduled!(
      { cron: '*/10 * * * *', type: 'cron', scheduledTime: Date.now() },
      env,
      ctx
    );

    // Wait for waitUntil promises to finish
    await Promise.all(waitUntilPromises);

    expect(runCapacityMaintenance).toHaveBeenCalledWith(env);
    expect(refreshPublicFeedSnapshot).toHaveBeenCalledWith(env, {
      force: true,
      strict: true,
    });
    expect(performDatabaseBackup).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('handles and logs on capacity maintenance failure during */10 * * * * cron', async () => {
    const error = new Error('Capacity error');
    vi.mocked(runCapacityMaintenance).mockRejectedValue(error);
    vi.mocked(refreshPublicFeedSnapshot).mockResolvedValue();
    vi.mocked(performDatabaseBackup).mockResolvedValue({ success: true });

    await worker.scheduled!(
      { cron: '*/10 * * * *', type: 'cron', scheduledTime: Date.now() },
      env,
      ctx
    );

    // Wait for waitUntil promises to finish
    await Promise.all(waitUntilPromises);

    expect(runCapacityMaintenance).toHaveBeenCalledWith(env);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[cron] capacity maintenance failed:',
      error
    );
  });

  it('handles and alerts on snapshot failure', async () => {
    const error = new Error('Snapshot error');
    vi.mocked(runCapacityMaintenance).mockResolvedValue();
    vi.mocked(refreshPublicFeedSnapshot).mockRejectedValue(error);
    vi.mocked(performDatabaseBackup).mockResolvedValue({ success: true });

    await worker.scheduled!(
      { cron: '0 0 * * *', type: 'cron', scheduledTime: Date.now() },
      env,
      ctx
    );

    // Wait for the IIFE to finish
    await Promise.all(waitUntilPromises);

    expect(refreshPublicFeedSnapshot).toHaveBeenCalledWith(env, {
      force: true,
      strict: true,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Worker Scheduled snapshot Error]',
      error
    );
  });

  it('handles and alerts on database backup failure (success = false)', async () => {
    vi.mocked(runCapacityMaintenance).mockResolvedValue();
    vi.mocked(refreshPublicFeedSnapshot).mockResolvedValue();
    vi.mocked(performDatabaseBackup).mockResolvedValue({
      success: false,
      error: 'Backup failed',
    });

    await worker.scheduled!(
      { cron: '0 0 * * *', type: 'cron', scheduledTime: Date.now() },
      env,
      ctx
    );

    // Wait for the IIFE to finish
    await Promise.all(waitUntilPromises);

    expect(performDatabaseBackup).toHaveBeenCalledWith(env);
    expect(sendErrorAlert).toHaveBeenCalledWith(
      env,
      new Error('Backup failed'),
      { source: 'scheduled_backup' }
    );
  });

  it('alerts on a scheduled backup failure when only the EMAIL binding is configured', async () => {
    env = {
      EMAIL: { send: vi.fn() },
    } as unknown as Bindings;
    vi.mocked(refreshPublicFeedSnapshot).mockResolvedValue();
    vi.mocked(performDatabaseBackup).mockResolvedValue({
      success: false,
      error: 'Backup failed',
    });

    await worker.scheduled!(
      { cron: '0 3 * * *', type: 'cron', scheduledTime: Date.now() },
      env,
      ctx
    );
    await Promise.all(waitUntilPromises);

    expect(sendErrorAlert).toHaveBeenCalledWith(
      env,
      new Error('Backup failed'),
      { source: 'scheduled_backup' }
    );
  });

  it('records an overlapping manual backup as skipped without an operational failure alert', async () => {
    vi.mocked(refreshPublicFeedSnapshot).mockResolvedValue();
    vi.mocked(performDatabaseBackup).mockResolvedValue({
      success: false,
      busy: true,
      error: 'Another database backup is already running',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await worker.scheduled!(
        { cron: '0 3 * * *', type: 'cron', scheduledTime: Date.now() },
        env,
        ctx
      );
      await Promise.all(waitUntilPromises);
      expect(sendErrorAlert).not.toHaveBeenCalled();
      expect(log.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual(
        expect.objectContaining({
          event: 'database_backup',
          success: false,
          skipped: true,
        })
      );
    } finally {
      log.mockRestore();
    }
  });

  it('handles and alerts on global scheduled block error', async () => {
    const error = new Error('Global backup error');
    vi.mocked(runCapacityMaintenance).mockResolvedValue();
    vi.mocked(refreshPublicFeedSnapshot).mockResolvedValue();
    vi.mocked(performDatabaseBackup).mockRejectedValue(error);

    await worker.scheduled!(
      { cron: '0 0 * * *', type: 'cron', scheduledTime: Date.now() },
      env,
      ctx
    );

    // Wait for the IIFE to finish
    await Promise.all(waitUntilPromises);

    expect(performDatabaseBackup).toHaveBeenCalledWith(env);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Worker Scheduled Backup Error]',
      error
    );
    expect(sendErrorAlert).toHaveBeenCalledWith(env, error, {
      source: 'scheduled_backup',
    });
  });
});
