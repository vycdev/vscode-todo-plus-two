import { expect } from 'chai';
import { createPlannedRefresh } from '../src/utils/planned-refresh';

interface ClockContext {
  refresh: ReturnType<typeof createPlannedRefresh>;
  timers: Map<object, { callback: () => void; delay: number }>;
  getRefreshes: () => number;
  setEnabled: (value: boolean) => void;
  setNow: (value: number) => void;
  tick: () => void;
}

const withClock = (run: (context: ClockContext) => void) => {
  const originalNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = new Map<object, { callback: () => void; delay: number }>();
  let now = 12345;
  let enabled = true;
  let refreshes = 0;

  Date.now = () => now;
  global.setTimeout = ((callback, delay) => {
    const handle = {};
    timers.set(handle, { callback, delay });
    return handle;
  }) as any;
  global.clearTimeout = ((handle) => timers.delete(handle)) as any;

  const refresh = createPlannedRefresh(
    () => refreshes++,
    () => enabled
  );
  try {
    run({
      refresh,
      timers,
      getRefreshes: () => refreshes,
      setEnabled: (value: boolean) => (enabled = value),
      setNow: (value: number) => (now = value),
      tick: () => {
        const [handle, timer] = Array.from(timers.entries())[0];
        timers.delete(handle);
        now += timer.delay;
        timer.callback();
      },
    });
  } finally {
    refresh.dispose();
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
};

describe('Planned decoration clock', () => {
  it('does no decoration work when disabled from startup', () => {
    let refreshes = 0;
    const refresh = createPlannedRefresh(
      () => refreshes++,
      () => false
    );
    try {
      refresh.refresh();
      refresh.refresh();
      expect(refreshes).to.equal(0);
    } finally {
      refresh.dispose();
    }
  });

  it('refreshes at minute boundaries without text edits and rearms only one timer', () => {
    withClock(({ refresh, timers, tick, getRefreshes }) => {
      expect(Array.from(timers.values())[0].delay).to.equal(47655);
      tick();
      expect(getRefreshes()).to.equal(1);
      expect(Array.from(timers.values())[0].delay).to.equal(60000);
      tick();
      expect(getRefreshes()).to.equal(2);
      refresh.refresh();
      refresh.refresh();
      expect(timers.size).to.equal(1);
    });
  });

  it('clears highlights when disabled, stops ticking, and resumes when re-enabled', () => {
    withClock(({ refresh, timers, setEnabled, getRefreshes }) => {
      setEnabled(false);
      refresh.refresh();
      expect(getRefreshes()).to.equal(1);
      expect(timers.size).to.equal(0);
      refresh.refresh();
      expect(getRefreshes()).to.equal(1);
      setEnabled(true);
      refresh.refresh();
      expect(timers.size).to.equal(1);
    });
  });

  it('realigns after sleep or a clock change and ignores callbacks after disposal', () => {
    withClock(({ refresh, timers, setNow, getRefreshes }) => {
      setNow(300000 + 45000);
      refresh.refresh();
      expect(Array.from(timers.values())[0].delay).to.equal(15000);
      const staleCallback = Array.from(timers.values())[0].callback;
      refresh.dispose();
      expect(timers.size).to.equal(0);
      staleCallback();
      refresh.refresh();
      expect(getRefreshes()).to.equal(1);
      expect(timers.size).to.equal(0);
    });
  });
});
