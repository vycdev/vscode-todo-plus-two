import Config from '../config';

const DEFAULT_REFRESH_DELAY = 250,
  MAX_REFRESH_DELAY = 10000;

// Delay between the last edit and refreshes that look beyond the edited document.
export const getRefreshDelay = (value: any = Config.getKey('refreshDelay')): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_REFRESH_DELAY;
  }

  return Math.min(Math.floor(value), MAX_REFRESH_DELAY);
};

// Trailing debounce that reads the delay on every call, so setting changes apply
// to the next edit without recreating listeners.
export const debounceRefresh = (callback: () => void, getDelay = () => getRefreshDelay()) => {
  let timer: ReturnType<typeof setTimeout>;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      callback();
    }, getDelay());
  };

  return Object.assign(schedule, { cancel: () => clearTimeout(timer) });
};
