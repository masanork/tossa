// web/src/lib/focusTrap.ts: Svelte Action for Modal Focus Trapping & Return Focus (WAI-ARIA Dialog Pattern)

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function focusTrap(
  node: HTMLElement,
  options: { enabled?: boolean; onEscape?: () => void } = {}
) {
  let previouslyFocused: HTMLElement | null = null;
  let enabled = options.enabled ?? true;

  if (typeof document !== 'undefined') {
    previouslyFocused = document.activeElement as HTMLElement | null;
  }

  function getFocusableElements(): HTMLElement[] {
    const elements = Array.from(
      node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
    );
    return elements.filter(
      (el) => el.offsetParent !== null && !el.hasAttribute('disabled')
    );
  }

  function trap(e: KeyboardEvent) {
    if (!enabled) return;

    if (e.key === 'Escape') {
      if (options.onEscape) {
        e.preventDefault();
        options.onEscape();
      }
      return;
    }

    if (e.key !== 'Tab') return;

    const focusables = getFocusableElements();
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (
        document.activeElement === first ||
        !node.contains(document.activeElement)
      ) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (
        document.activeElement === last ||
        !node.contains(document.activeElement)
      ) {
        e.preventDefault();
        first?.focus();
      }
    }
  }

  // Initial focus
  const scheduleInitialFocus =
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);

  scheduleInitialFocus(() => {
    if (!enabled) return;
    const focusables = getFocusableElements();
    // Prefer autofocus element, otherwise first focusable
    const auto = node.querySelector<HTMLElement>('[autofocus]');
    if (auto && node.contains(auto)) {
      auto.focus();
    } else if (focusables.length > 0) {
      focusables[0]?.focus();
    }
  });

  node.addEventListener('keydown', trap);

  return {
    update(newOptions: { enabled?: boolean; onEscape?: () => void } = {}) {
      enabled = newOptions.enabled ?? true;
      options = newOptions;
    },
    destroy() {
      node.removeEventListener('keydown', trap);
      // Return focus to previously focused element when modal closes
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    },
  };
}
