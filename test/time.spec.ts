import { expect } from 'chai';
import Time from '../src/utils/time';

describe('Time utilities', () => {
    it('keeps precise long diffs working with the Moment package alias', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const to = new Date('2020-01-01T01:02:03Z');

        expect(Time.diff(to, from, 'long')).to.equal('1 hour 2 minutes 3 seconds');
    });

    it('uses 24 hours per day by default for short durations', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const to = new Date('2020-01-02T01:00:00Z');

        expect(Time.diff(to, from, 'short-compact')).to.equal('1d1h');
    });

    it('supports configurable hours per day for short durations', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const to = new Date('2020-01-02T01:00:00Z');

        expect(Time.diff(to, from, 'short-compact', 8)).to.equal('3d1h');
    });
});
