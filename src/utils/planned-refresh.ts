export const createPlannedRefresh = (refresh: () => void, isEnabled: () => boolean) => {
  let timer: ReturnType<typeof setTimeout>;
  let disposed = false;
  let wasEnabled = isEnabled();

  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;

    if (disposed || !isEnabled()) return;

    timer = setTimeout(update, 60000 - (Date.now() % 60000));
  };

  const update = () => {
    if (disposed) return;
    const enabled = isEnabled();
    // Clear an existing highlight on disablement without adding tag parsing to
    // every editor event for users who have never enabled scheduling.
    if (enabled || wasEnabled) refresh();
    wasEnabled = enabled;
    schedule();
  };

  schedule();

  return {
    refresh: update,
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
    },
  };
};
