const CAPABILITY = 'indexeddb-v1';
const CHECK_TIMEOUT_MS = 5000;
let registeredListener: ((event: MessageEvent) => void) | null = null;
let registrationUsers = 0;

export class OutboxCompatibilityError extends Error {
  constructor() {
    super(
      '端末保存を更新するため、ほかのTossaの画面とホーム画面アプリをすべて閉じて、もう一度開いてください。未送信データは保持しています。'
    );
    this.name = 'OutboxCompatibilityError';
  }
}

/** Register before reading the outbox, so other windows can check this client. */
export function registerOutboxClient(): () => void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker)
    return () => {};
  if (!registeredListener) {
    registeredListener = (event: MessageEvent) => {
      if (event.data?.type === 'OUTBOX_CLIENT_CHECK') {
        event.ports[0]?.postMessage({ capability: CAPABILITY });
      }
    };
    navigator.serviceWorker.addEventListener('message', registeredListener);
  }
  registrationUsers++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    registrationUsers--;
    if (registrationUsers === 0 && registeredListener) {
      navigator.serviceWorker.removeEventListener(
        'message',
        registeredListener
      );
      registeredListener = null;
    }
  };
}

/**
 * An old window can overwrite an entire legacy localStorage queue. Only a
 * worker which has checked every open same-origin client can authorize the
 * transition to IndexedDB. An unknown/old worker fails closed.
 */
export async function assertOutboxStorageCompatible(): Promise<void> {
  // Unit tests have no browser clients. Vite's isolated development server
  // deliberately does not install a service worker (see main.ts).
  if (typeof window === 'undefined' || import.meta.env.DEV) return;
  if (!navigator.serviceWorker) throw new OutboxCompatibilityError();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel = new MessageChannel();
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new OutboxCompatibilityError()),
        CHECK_TIMEOUT_MS
      );
      channel.port1.onmessage = (event) => {
        if (event.data?.type !== 'OUTBOX_STORAGE_RESULT') return;
        if (event.data.ready === true) resolve();
        else reject(new OutboxCompatibilityError());
      };
      // ready also covers the first visit, whose registration occurs at load.
      void navigator.serviceWorker.ready
        .then((registration) => {
          if (!registration.active) throw new OutboxCompatibilityError();
          registration.active.postMessage(
            { type: 'OUTBOX_STORAGE_CHECK', capability: CAPABILITY },
            [channel.port2]
          );
        })
        .catch(reject);
    });
  } finally {
    clearTimeout(timer);
    channel.port1.close();
    channel.port2.close();
  }
}
