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

    it('renders zero short durations as 0s', () => {
        const instant = new Date('2020-01-01T00:00:00Z');

        expect(Time.diff(instant, instant, 'short')).to.equal('0s');
        expect(Time.diff(instant, instant, 'short-compact')).to.equal('0s');
    });

    it('supports flat man-hours formatting', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const to = new Date(from.getTime() + (25 * 3600 + 15 * 60) * 1000);

        expect(Time.diff(to, from, 'man-hours')).to.equal('25h15m');
    });

    it('supports man-days formatting', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const to = new Date(from.getTime() + 25 * 3600 * 1000);

        expect(Time.diff(to, from, 'man-days', 24, 8, 5)).to.equal('3md 1h');
    });

    it('supports man-weeks formatting', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const to = new Date(from.getTime() + 88 * 3600 * 1000);

        expect(Time.diff(to, from, 'man-weeks', 24, 8, 5)).to.equal('2mw 1md');
    });

    it('supports configurable man-day and man-week sizes', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const to = new Date(from.getTime() + 36 * 3600 * 1000);

        expect(Time.diff(to, from, 'man-weeks', 24, 6, 3)).to.equal('2mw');
    });
});
