import { expect } from 'chai';
import { evaluateStatisticsCondition } from '../src/utils/statistics-condition';

describe('Statistics conditions', () => {
  it('evaluates boolean and expression conditions', () => {
    expect(evaluateStatisticsCondition(true)).to.equal(true);
    expect(evaluateStatisticsCondition(false)).to.equal(false);
    expect(
      evaluateStatisticsCondition('global.all > project.all', { all: 2 }, { all: 1 })
    ).to.equal(true);
  });

  it('returns false for invalid expressions instead of throwing', () => {
    expect(() => evaluateStatisticsCondition('global.all >', { all: 1 }, undefined)).not.to.throw();
    expect(evaluateStatisticsCondition('global.all >', { all: 1 }, undefined)).to.equal(false);
  });

  it('returns false when an expression throws at runtime', () => {
    expect(evaluateStatisticsCondition('project.all > 0', { all: 1 }, undefined)).to.equal(false);
  });

  it('supports documented statistics comparisons and bracketed token names', () => {
    const globalTokens = { projects: 3, all: 9, 'est-total': '2h' },
      projectTokens = { all: 2 };

    expect(
      evaluateStatisticsCondition(
        'global.projects < 100 && project.all > 0',
        globalTokens,
        projectTokens
      )
    ).to.equal(true);
    expect(evaluateStatisticsCondition("global['est-total'] === '2h'", globalTokens)).to.equal(
      true
    );
    expect(evaluateStatisticsCondition('global["est-total"] !== ""', globalTokens)).to.equal(true);
  });

  it('preserves operator precedence, arithmetic and conditional expressions', () => {
    const cases: Array<[string, boolean]> = [
      ['1 + 2 * 3 === 7', true],
      ['(1 + 2) * 3 === 9', true],
      ['10 - 3 - 2 === 5', true],
      ['-2 * +3 === -6', true],
      ['5 % 2 === 1 && 6 / 2 === 3', true],
      ['.5 + 1e-1 < 1', true],
      ['!false && (false || true)', true],
      ['true || false && false', true],
      ['false ? false : true ? true : false', true],
      ['true ? false ? false : true : false', true],
      ["'2' == 2 && '2' !== 2", true],
      ["'a' + 'b' === 'ab'", true],
      ["'\\u0061' === 'a'", true],
      ['global.all >= 2 && global.all <= 3', true],
      ['global.all != 2', false],
      ['global.missing === undefined', true],
      ['global.missing == null', true],
    ];

    cases.forEach(([condition, expected]) => {
      expect(evaluateStatisticsCondition(condition, { all: 2 }), condition).to.equal(expected);
    });
  });

  it('short-circuits unavailable scopes and lazy statistics getters', () => {
    let reads = 0;
    const tokens = {
      get all() {
        reads++;
        return 2;
      },
    };

    expect(evaluateStatisticsCondition('true || project.all > 0', tokens)).to.equal(true);
    expect(evaluateStatisticsCondition('false && global.all > 0', tokens)).to.equal(false);
    expect(evaluateStatisticsCondition('true ? true : global.all > 0', tokens)).to.equal(true);
    expect(evaluateStatisticsCondition('false ? project.all : true', tokens)).to.equal(true);
    expect(evaluateStatisticsCondition('!project || project.all > 0', tokens)).to.equal(true);
    expect(reads).to.equal(0);
    expect(evaluateStatisticsCondition('global.all === 2', tokens)).to.equal(true);
    expect(reads).to.equal(1);
  });

  it('reads computed statistics getters inherited from the token model', () => {
    class Tokens {
      pending = 2;
      get all() {
        return this.pending;
      }
    }

    expect(evaluateStatisticsCondition('global.all > 0', new Tokens())).to.equal(true);
  });

  it('rejects code execution, assignments and prototype access without side effects', () => {
    const state = { changed: false },
      tokens = {
        all: 2,
        mutate: () => {
          state.changed = true;
          return true;
        },
      },
      conditions = [
        'global.mutate()',
        'global.all = 0',
        'global.all++',
        '(global.all = 0, true)',
        '(function () { global.all = 0; return true; })()',
        'require("fs")',
        'process.exit()',
        'globalThis.process',
        'global.constructor',
        'global["constructor"]',
        'global["\\u0063onstructor"]',
        'global.__proto__',
        'global["prototype"]',
        'global.all.constructor',
        'global["all"]["constructor"]',
        'global["con" + "structor"]',
        'global.toString()',
        '`template ${global.mutate()}`',
        'new Function("return true")()',
        'true || global.mutate()',
      ];

    conditions.forEach((condition) => {
      expect(evaluateStatisticsCondition(condition, tokens), condition).to.equal(false);
    });
    expect(state.changed).to.equal(false);
    expect(tokens.all).to.equal(2);
  });

  it('does not coerce token objects through executable valueOf methods', () => {
    let coerced = false;
    const token = {
      valueOf: () => {
        coerced = true;
        return 1;
      },
    };

    expect(evaluateStatisticsCondition('global.all > 0', { all: token })).to.equal(false);
    expect(evaluateStatisticsCondition('global > 0', token)).to.equal(false);
    expect(coerced).to.equal(false);
  });

  it('rejects malformed and excessively nested input', () => {
    [
      '"unclosed',
      "'bad\\q'",
      'global[]',
      'global[2]',
      '()',
      '1 2',
      'true ? 1',
      '('.repeat(150) + 'true' + ')'.repeat(150),
    ].forEach((condition) => {
      expect(evaluateStatisticsCondition(condition, {}), condition).to.equal(false);
    });
  });
});
