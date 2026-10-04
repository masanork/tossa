import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertOutboxStorageCompatible,
  registerOutboxClient,
} from '../web/src/lib/outboxCompatibility';

class Channel {
  port1 = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (data: unknown) => this.port2.onmessage?.({ data }),
    close: vi.fn(),
  };
  port2 = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (data: unknown) => this.port1.onmessage?.({ data }),
    close: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function browser(worker: unknown) {
  vi.stubEnv('DEV', false);
  vi.stubGlobal('window', {});
  vi.stubGlobal('MessageChannel', Channel);
  const serviceWorker = {
    ready: Promise.resolve({ active: worker }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('navigator', { serviceWorker });
  return serviceWorker;
}

describe('Outbox client compatibility gate', () => {
  it('requires a positive worker reply before permitting migration', async () => {
    const worker = {
      postMessage: vi.fn((_message, ports) => {
        ports[0].postMessage({ type: 'OUTBOX_STORAGE_RESULT', ready: true });
      }),
    };
    browser(worker);
    await expect(assertOutboxStorageCompatible()).resolves.toBeUndefined();
    expect(worker.postMessage.mock.calls[0][0]).toEqual({
      type: 'OUTBOX_STORAGE_CHECK',
      capability: 'indexeddb-v1',
    });
  });

  it('preserves the migration gate when an old worker never responds', async () => {
    vi.useFakeTimers();
    browser({ postMessage: vi.fn() });
    const pending = assertOutboxStorageCompatible();
    const result = expect(pending).rejects.toThrow('すべて閉じて');
    await vi.advanceTimersByTimeAsync(5000);
    await result;
  });

  it('rejects an incompatible client and browsers without a service worker', async () => {
    browser({
      postMessage: (_message: unknown, ports: Channel['port1'][]) =>
        ports[0].postMessage({ type: 'OUTBOX_STORAGE_RESULT', ready: false }),
    });
    await expect(assertOutboxStorageCompatible()).rejects.toThrow(
      '未送信データは保持'
    );
    vi.stubGlobal('navigator', {});
    await expect(assertOutboxStorageCompatible()).rejects.toThrow(
      '未送信データは保持'
    );
  });

  it('registers and removes the capability responder', () => {
    const sw = browser({});
    const cleanup = registerOutboxClient();
    const handler = sw.addEventListener.mock.calls[0][1];
    const reply = vi.fn();
    handler({
      data: { type: 'OUTBOX_CLIENT_CHECK' },
      ports: [{ postMessage: reply }],
    });
    expect(reply).toHaveBeenCalledWith({ capability: 'indexeddb-v1' });
    cleanup();
    expect(sw.removeEventListener).toHaveBeenCalledWith('message', handler);
  });
});

describe('Service worker checks every open client', () => {
  function check(clients: unknown[]) {
    const handlers: Record<string, (event: unknown) => void> = {};
    runInNewContext(readFileSync('web/public/sw.js', 'utf8'), {
      self: {
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
        clients: { matchAll: vi.fn(async () => clients) },
      },
      MessageChannel: Channel,
      setTimeout,
      clearTimeout,
    });
    const reply = vi.fn();
    let pending: Promise<void> | undefined;
    handlers.message({
      data: { type: 'OUTBOX_STORAGE_CHECK' },
      ports: [{ postMessage: reply, close: vi.fn() }],
      waitUntil: (promise: Promise<void>) => {
        pending = promise;
      },
    });
    return { reply, pending };
  }

  const modern = {
    postMessage: (_message: unknown, ports: Channel['port1'][]) =>
      ports[0].postMessage({ capability: 'indexeddb-v1' }),
  };

  it('accepts only when all windows support IndexedDB', async () => {
    const { reply, pending } = check([modern, modern]);
    await pending;
    expect(reply).toHaveBeenCalledWith({
      type: 'OUTBOX_STORAGE_RESULT',
      ready: true,
    });
  });

  it('times out an old window even when the requesting window is modern', async () => {
    vi.useFakeTimers();
    const { reply, pending } = check([modern, { postMessage: vi.fn() }]);
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    expect(reply).toHaveBeenCalledWith({
      type: 'OUTBOX_STORAGE_RESULT',
      ready: false,
    });
  });
});
