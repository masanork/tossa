// web/src/lib/swipeToDismiss.ts: Native Touch Drag-to-Dismiss Action for Mobile Bottom Sheets

export function swipeDown(node: HTMLElement, onDismiss: () => void) {
  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!touch) return;

    // Only initiate drag if scroll position of sheet is at top
    if (node.scrollTop > 0) return;

    startY = touch.clientY;
    currentY = startY;
    isDragging = true;
    node.style.transition = 'none';
  }

  function onTouchMove(e: TouchEvent) {
    if (!isDragging) return;
    const touch = e.touches[0];
    if (!touch) return;

    currentY = touch.clientY;
    const deltaY = currentY - startY;

    if (deltaY > 0) {
      if (e.cancelable) e.preventDefault();
      node.style.transform = `translateY(${deltaY}px)`;
    }
  }

  function onTouchEnd() {
    if (!isDragging) return;
    isDragging = false;
    const deltaY = currentY - startY;
    node.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';

    if (deltaY > 100) {
      node.style.transform = 'translateY(100%)';
      setTimeout(onDismiss, 180);
    } else {
      node.style.transform = '';
    }
  }

  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('touchend', onTouchEnd);

  return {
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
    },
  };
}
