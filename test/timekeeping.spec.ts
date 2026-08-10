import { expect } from 'chai';
import {
    formatElapsedDuration,
    getTimerState,
    getToggleTag,
    parseStartedDate,
} from '../src/utils/timekeeping';

describe('Timekeeping utilities', () => {
    const format = 'YYYY-MM-DD HH:mm:ss';

    it('parses the timestamp from a started tag', () => {
        const startedDate = parseStartedDate(' @started(26-07-29 12:34)', 'YY-MM-DD HH:mm');

        expect(startedDate).to.be.instanceOf(Date);
        expect(startedDate.getFullYear()).to.equal(2026);
        expect(startedDate.getMonth()).to.equal(6);
        expect(startedDate.getDate()).to.equal(29);
        expect(startedDate.getHours()).to.equal(12);
        expect(startedDate.getMinutes()).to.equal(34);
    });

    it('does not invent a date for a timestamp-free started tag', () => {
        expect(parseStartedDate(' @started', 'YY-MM-DD HH:mm')).to.equal(undefined);
    });

    it('rejects a started tag that does not match the configured format', () => {
        expect(parseStartedDate('@started(not-a-date)', 'YY-MM-DD HH:mm')).to.equal(undefined);
    });

    it('formats elapsed durations using configured man-time sizes', () => {
        const from = new Date('2020-01-01T00:00:00Z'),
            to = new Date(from.getTime() + 42 * 3600 * 1000);

        expect(formatElapsedDuration(to, from, 'man-weeks', 24, 6, 3)).to.equal('2mw 1md');
    });

    it('formats toggle tags like started timestamps', () => {
        expect(getToggleTag(format, new Date(2026, 7, 2, 10, 30, 45))).to.equal(
            '@toggle(2026-08-02 10:30:45)'
        );
    });

    it('tracks uninterrupted started time as active', () => {
        const state = getTimerState(
            '☐ Task @started(2026-08-02 10:00:00)',
            format,
            new Date(2026, 7, 2, 12, 0, 0)
        );

        expect(state.active).to.equal(true);
        expect(state.elapsedMilliseconds).to.equal(2 * 60 * 60 * 1000);
    });

    it('stops accumulating time after an odd toggle', () => {
        const state = getTimerState(
            '☐ Task @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00)',
            format,
            new Date(2026, 7, 2, 12, 0, 0)
        );

        expect(state.active).to.equal(false);
        expect(state.elapsedMilliseconds).to.equal(30 * 60 * 1000);
    });

    it('accumulates each active interval after resuming', () => {
        const state = getTimerState(
            '☐ Task @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00) @toggle(2026-08-02 11:00:00)',
            format,
            new Date(2026, 7, 2, 12, 0, 0)
        );

        expect(state.active).to.equal(true);
        expect(state.elapsedMilliseconds).to.equal(90 * 60 * 1000);
    });

    it('ignores toggles before the active started tag', () => {
        const state = getTimerState(
            '☐ Task @toggle(2026-08-02 09:00:00) @started(2026-08-02 10:00:00)',
            format,
            new Date(2026, 7, 2, 11, 0, 0)
        );

        expect(state.active).to.equal(true);
        expect(state.toggleDates).to.deep.equal([]);
        expect(state.elapsedMilliseconds).to.equal(60 * 60 * 1000);
    });

    it('ignores invalid, future, and out-of-order toggles', () => {
        const state = getTimerState(
            '☐ Task @started(2026-08-02 10:00:00) @toggle(invalid) @toggle(2026-08-02 09:00:00) @toggle(2026-08-02 13:00:00)',
            format,
            new Date(2026, 7, 2, 12, 0, 0)
        );

        expect(state.active).to.equal(true);
        expect(state.toggleDates).to.deep.equal([]);
        expect(state.elapsedMilliseconds).to.equal(2 * 60 * 60 * 1000);
    });

    it('does not treat tags attached to words or inline code as toggles', () => {
        const state = getTimerState(
            '☐ Task @started(2026-08-02 10:00:00) word@toggle(2026-08-02 10:30:00) `example @toggle(2026-08-02 10:45:00)`',
            format,
            new Date(2026, 7, 2, 11, 0, 0)
        );

        expect(state.active).to.equal(true);
        expect(state.toggleDates).to.deep.equal([]);
    });

    it('ignores toggles inside matching multi-backtick code spans', () => {
        const state = getTimerState(
            '☐ Task @started(2026-08-02 10:00:00) ``example @toggle(2026-08-02 10:30:00)``',
            format,
            new Date(2026, 7, 2, 11, 0, 0)
        );

        expect(state.active).to.equal(true);
        expect(state.toggleDates).to.deep.equal([]);
        expect(state.elapsedMilliseconds).to.equal(60 * 60 * 1000);
    });

    it('does not start a timer from an inline-code tag', () => {
        expect(
            getTimerState(
                '☐ Task `example @started(2026-08-02 10:00:00)`',
                format,
                new Date(2026, 7, 2, 11, 0, 0)
            )
        ).to.equal(undefined);
    });

    it('does not start a timer from a matching multi-backtick code span', () => {
        expect(
            getTimerState(
                '☐ Task ``example @started(2026-08-02 10:00:00)``',
                format,
                new Date(2026, 7, 2, 11, 0, 0)
            )
        ).to.equal(undefined);
    });
});
