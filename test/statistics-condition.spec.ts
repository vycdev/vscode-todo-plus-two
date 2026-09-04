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
        expect(() =>
            evaluateStatisticsCondition('global.all >', { all: 1 }, undefined)
        ).not.to.throw();
        expect(evaluateStatisticsCondition('global.all >', { all: 1 }, undefined)).to.equal(false);
    });

    it('returns false when an expression throws at runtime', () => {
        expect(evaluateStatisticsCondition('project.all > 0', { all: 1 }, undefined)).to.equal(
            false
        );
    });
});
