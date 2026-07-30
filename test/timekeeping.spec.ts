import { expect } from 'chai';
import { parseStartedDate } from '../src/utils/timekeeping';

describe('Timekeeping utilities', () => {
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
});
