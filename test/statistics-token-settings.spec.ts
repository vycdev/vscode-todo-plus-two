import { expect } from 'chai';

const loadStatistics = (settings) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    subjectPath = require.resolve('../src/utils/statistics'),
    previous = require.cache[subjectPath];
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode') return {};
    if (request === '../config') return { default: { getKey: (key) => settings[key] } };
    if (request === '../consts' || request === './ast') return { default: {} };
    if (request === '../todo/items') return {};
    if (request === './statistics_tokens') return { default: class Tokens {} };
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[subjectPath];
    return require(subjectPath).default;
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    if (previous) require.cache[subjectPath] = previous;
  }
};

describe('Statistics derived token settings', () => {
  it('collects both elapsed components when only the combined token is used', () => {
    const settings = { 'statistics.statusbar.text': '[elapsed]' };
    const statistics = loadStatistics(settings);
    statistics.tokens.updateDisabledAll();
    expect(statistics.tokens.disabled.global.lasted).to.equal(false);
    expect(statistics.tokens.disabled.global.wasted).to.equal(false);
    expect(statistics.tokens.disabled.global.est).to.equal(true);

    settings['statistics.statusbar.text'] = '[pending]';
    statistics.tokens.updateDisabledAll();
    expect(statistics.tokens.disabled.global.lasted).to.equal(true);
    expect(statistics.tokens.disabled.global.wasted).to.equal(true);
  });
});
