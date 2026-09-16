// web/src/lib/modalManager.svelte.ts: Responsive Mobile Multi-Modal & Bottom Sheet Coordinator

export type ModalName =
  | 'create'
  | 'admin'
  | 'messages'
  | 'update_status'
  | 'offline_map'
  | 'qr_code'
  | 'qr_scanner';

class ModalManager {
  stack = $state<ModalName[]>([]);
  private isHandlingPopstate = false;
  private ignoreNextPopstate = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', (_event) => {
        if (this.ignoreNextPopstate) {
          this.ignoreNextPopstate = false;
          return;
        }
        if (this.stack.length > 0) {
          this.isHandlingPopstate = true;
          this.stack.pop();
          this.updateBodyScrollLock();
          this.isHandlingPopstate = false;
        }
      });

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && this.stack.length > 0) {
          this.closeTop();
        }
      });
    }
  }

  isOpen(name: ModalName): boolean {
    return this.stack.includes(name);
  }

  isTop(name: ModalName): boolean {
    const top = this.stack[this.stack.length - 1];
    return top === name;
  }

  getZIndex(name: ModalName): number {
    const idx = this.stack.indexOf(name);
    if (idx === -1) return 50;
    return 50 + idx * 10;
  }

  open(name: ModalName): void {
    if (!this.stack.includes(name)) {
      this.stack.push(name);
      this.updateBodyScrollLock();

      if (typeof window !== 'undefined') {
        history.pushState({ tossaModal: name }, '');
      }
    }
  }

  close(name: ModalName): void {
    const idx = this.stack.indexOf(name);
    if (idx !== -1) {
      this.stack.splice(idx, 1);
      this.updateBodyScrollLock();

      if (typeof window !== 'undefined' && !this.isHandlingPopstate) {
        if (history.state?.tossaModal) {
          this.ignoreNextPopstate = true;
          history.back();
        }
      }
    }
  }

  closeTop(): void {
    const top = this.stack[this.stack.length - 1];
    if (top !== undefined) {
      this.close(top);
    }
  }

  closeAll(): void {
    while (this.stack.length > 0) {
      this.closeTop();
    }
  }

  private updateBodyScrollLock(): void {
    if (typeof document !== 'undefined') {
      if (this.stack.length > 0) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }
  }
}

export const modalManager = new ModalManager();
