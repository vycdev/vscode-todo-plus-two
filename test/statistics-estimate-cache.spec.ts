import { expect } from 'chai';
import Time from '../src/utils/time';

const loadStatistics = () => {
  const Module = require('module'),
    originalLoad = Module._load,
    statisticsPath = require.resolve('../src/utils/statistics'),
    previousStatistics = require.cache[statisticsPath];

  try {
    Module._load = (request, parent, isMain) => {
      if (request === '../config') {
        return { default: { getKey: (key: string) => (key === 'manDaysPerWeek' ? 5 : 8) } };
      }
      if (request === '../todo/items' || request === '../consts' || request === './ast') return {};
      if (request === 'vscode') return {};
      return originalLoad(request, parent, isMain);
    };
    delete require.cache[statisticsPath];
    return require(statisticsPath).default;
  } finally {
    Module._load = originalLoad;
    delete require.cache[statisticsPath];
    if (previousStatistics) require.cache[statisticsPath] = previousStatistics;
  }
};

describe('Statistics date estimates', () => {
  it('recalculates an absolute estimate when the reference time advances', () => {
    const statistics = loadStatistics(),
      earlier = new Date(2026, 9, 23, 12),
      later = new Date(2026, 9, 23, 13),
      tag = '@est(2026-10-24)';

    expect(statistics.timeTags.parseEstimate(tag, earlier)).to.equal(
      Time.durationSeconds('2026-10-24', earlier)
    );
    expect(statistics.timeTags.parseEstimate(tag, later)).to.equal(
      Time.durationSeconds('2026-10-24', later)
    );
  });

  it('recalculates natural-language estimates across reference times', () => {
    const statistics = loadStatistics(),
      earlier = new Date(2026, 9, 23, 12),
      later = new Date(2026, 9, 23, 13);

    expect(statistics.timeTags.parseEstimate('@est(tomorrow)', earlier)).to.equal(
      Time.durationSeconds('tomorrow', earlier)
    );
    expect(statistics.timeTags.parseEstimate('@est(tomorrow)', later)).to.equal(
      Time.durationSeconds('tomorrow', later)
    );
  });

  it('keeps a duration estimate stable across reference times', () => {
    const statistics = loadStatistics();
    expect(statistics.timeTags.parseEstimate('@est(2h)', new Date(2026, 9, 23, 12))).to.equal(7200);
    expect(statistics.timeTags.parseEstimate('@est(2h)', new Date(2026, 9, 24, 12))).to.equal(7200);
  });
});
