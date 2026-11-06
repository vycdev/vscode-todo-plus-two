import { expect } from 'chai';

const loadRefreshDelay = (settings: { refreshDelay?: any }) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    modulePath = require.resolve('../src/utils/refresh-delay'),
    previousModule = require.cache[modulePath];

  NodeModule._load = function (request: string, parent, isMain: boolean) {
    if (parent && parent.filename === modulePath && request === '../config') {
      return { default: { getKey: (key: string) => settings[key] } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    NodeModule._load = originalLoad;
    if (previousModule) require.cache[modulePath] = previousModule;
    else delete require.cache[modulePath];
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Refresh delay', () => {
  it('reads todo.refreshDelay and falls back for missing or invalid values', () => {
    const settings: { refreshDelay?: any } = {};
    const { getRefreshDelay } = loadRefreshDelay(settings);

    expect(getRefreshDelay()).to.equal(250);
    settings.refreshDelay = 800;
    expect(getRefreshDelay()).to.equal(800);
    [-1, NaN, Infinity, '500', null].forEach((value) => {
      expect(getRefreshDelay(value)).to.equal(250);
    });
    expect(getRefreshDelay(0)).to.equal(0);
    expect(getRefreshDelay(12.7)).to.equal(12);
    expect(getRefreshDelay(60000)).to.equal(10000);
  });

  it('coalesces calls, applies delay changes to the next call, and can be cancelled', async () => {
    const { debounceRefresh } = loadRefreshDelay({});
    let delay = 30,
      calls = 0;
    const refresh = debounceRefresh(
      () => calls++,
      () => delay
    );

    refresh();
    refresh();
    await wait(60);
    expect(calls).to.equal(1);

    delay = 0;
    refresh();
    await wait(10);
    expect(calls).to.equal(2);

    refresh();
    refresh.cancel();
    await wait(10);
    expect(calls).to.equal(2);
  });
});
