(() => {
  window.__oyasumiDashboardScroll?.dispose();
  document.documentElement.dataset.vrDashboard = 'true';
  const targets = new Map();
  let frame = 0;
  let previousTime = 0;

  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
    targets.clear();
  }

  function animate(time) {
    const fraction = 1 - Math.exp(-(time - previousTime) / 40);
    previousTime = time;
    for (const [element, target] of targets) {
      if (!element.isConnected) {
        targets.delete(element);
        continue;
      }
      target.x = Math.min(target.x, element.scrollWidth - element.clientWidth);
      target.y = Math.min(target.y, element.scrollHeight - element.clientHeight);
      const x = target.x - element.scrollLeft;
      const y = target.y - element.scrollTop;
      element.scrollTo({
        left: Math.abs(x) <= 1 ? target.x : element.scrollLeft + x * fraction,
        top: Math.abs(y) <= 1 ? target.y : element.scrollTop + y * fraction,
        behavior: 'instant',
      });
      if (Math.abs(x) <= 1 && Math.abs(y) <= 1) targets.delete(element);
    }
    frame = targets.size ? requestAnimationFrame(animate) : 0;
  }

  function scroll(x, y, deltaX, deltaY) {
    let consumed = false;
    for (const [axis, delta, size, client, overflow, overscroll] of [
      ['x', deltaX, 'scrollWidth', 'clientWidth', 'overflowX', 'overscrollBehaviorX'],
      ['y', deltaY, 'scrollHeight', 'clientHeight', 'overflowY', 'overscrollBehaviorY'],
    ]) {
      let remaining = delta;
      for (
        let element = document.elementFromPoint(x, y);
        element && remaining;
        element = element.parentElement
      ) {
        if (!(element instanceof HTMLElement)) continue;
        const style = getComputedStyle(element);
        if (!['auto', 'scroll'].includes(style[overflow])) continue;
        const maximum = element[size] - element[client];
        if (maximum <= 0) continue;
        const target = targets.get(element) ?? { x: element.scrollLeft, y: element.scrollTop };
        const before = target[axis];
        target[axis] = Math.max(0, Math.min(maximum, before + remaining));
        const used = target[axis] - before;
        if (used) {
          targets.set(element, target);
          remaining -= used;
          consumed = true;
        }
        if (style[overscroll] !== 'auto') break;
      }
    }
    if (!consumed) return;
    if (!frame) {
      previousTime = performance.now();
      frame = requestAnimationFrame(animate);
    }
  }

  window.__oyasumiDashboardScroll = {
    cancel,
    scroll,
    dispose() {
      cancel();
      delete window.__oyasumiDashboardScroll;
    },
  };
})();
