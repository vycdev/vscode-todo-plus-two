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

    it('renders zero clock durations as 0', () => {
        const instant = new Date('2020-01-01T00:00:00Z');

        expect(Time.diff(instant, instant, 'clock')).to.equal('0');
    });

    it('round-trips clock durations', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const durations = [0, 30, 59, 60, 3600, 8 * 24 * 3600, 365 * 24 * 3600, -3600];

        durations.forEach((seconds) => {
            const to = new Date(from.getTime() + seconds * 1000),
                clock = Time.diff(to, from, 'clock');

            expect(Time.durationSeconds(clock, from)).to.equal(seconds);
        });

        expect(Time.durationSeconds('1:60', from)).to.equal(0);
        expect(Time.durationSeconds('1:', from)).to.equal(0);
        expect(Time.durationSeconds('2020', from)).to.equal(0);
        expect(Time.durationSeconds(30 as any, from)).to.equal(0);
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

    it('parses man-time durations using the configured sizes', () => {
        const from = new Date('2020-01-01T00:00:00Z');

        expect(Time.diffSeconds('1md 2h', from, 8, 5)).to.equal(10 * 3600);
        expect(Time.diffSeconds('2mw 1md', from, 6, 3)).to.equal(42 * 3600);
        expect(Time.diffSeconds('1mw1md', from, 8, 5)).to.equal(48 * 3600);
    });

    it('round-trips formatted man-time durations', () => {
        const from = new Date('2020-01-01T00:00:00Z');
        const to = new Date(from.getTime() + 42 * 3600 * 1000);
        const formatted = Time.diff(to, from, 'man-weeks', 24, 6, 3);

        expect(Time.diffSeconds(formatted, from, 6, 3)).to.equal(42 * 3600);
        expect(Time.diff(formatted, from, 'man-weeks', 24, 6, 3)).to.equal(formatted);
    });
});
