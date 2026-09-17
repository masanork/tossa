// web/src/lib/announcer.svelte.ts: Accessible Live Region Announcer for Screen Readers (WCAG 4.1.3)

class AnnouncerState {
  politeMessage = $state('');
  assertiveMessage = $state('');
  private politeTimer: ReturnType<typeof setTimeout> | null = null;
  private assertiveTimer: ReturnType<typeof setTimeout> | null = null;

  announce(message: string, priority: 'polite' | 'assertive' = 'polite') {
    if (!message) return;

    if (priority === 'assertive') {
      if (this.assertiveTimer) clearTimeout(this.assertiveTimer);
      // Brief clear to trigger screen reader re-announcement if message is the same
      this.assertiveMessage = '';
      setTimeout(() => {
        this.assertiveMessage = message;
        this.assertiveTimer = setTimeout(() => {
          this.assertiveMessage = '';
        }, 5000);
      }, 50);
    } else {
      if (this.politeTimer) clearTimeout(this.politeTimer);
      this.politeMessage = '';
      setTimeout(() => {
        this.politeMessage = message;
        this.politeTimer = setTimeout(() => {
          this.politeMessage = '';
        }, 5000);
      }, 50);
    }
  }
}

export const announcer = new AnnouncerState();
