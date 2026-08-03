import { expect } from 'chai';
import Timestamps from '../src/utils/timestamps';

describe('Timestamp utilities', () => {
    it('expands @created with the configured timestamp format', () => {
        const date = new Date(2026, 6, 2, 10, 34);

        expect(Timestamps.expand('@created', 'YYYY-MM-DD HH:mm', date)).to.equal(
            '@created(2026-07-02 10:34)'
        );
    });

    it('expands @now to the raw timestamp', () => {
        const date = new Date(2026, 6, 2, 10, 34);

        expect(Timestamps.expand('@now', 'YYYY-MM-DD HH:mm', date)).to.equal('2026-07-02 10:34');
    });

    it('detects an active @ prefix before the cursor', () => {
        expect(Timestamps.getPrefix('Meeting @cre', 12)).to.deep.equal({
            text: '@cre',
            start: 8,
            end: 12,
        });
    });

    it('ignores timestamp prefixes inside inline code', () => {
        expect(Timestamps.getPrefix('`note @cre', 10)).to.equal(undefined);
        expect(Timestamps.getPrefix('`note @cre`', 11)).to.equal(undefined);
        expect(Timestamps.getPrefix('`note` @cre', 11)).to.deep.equal({
            text: '@cre',
            start: 7,
            end: 11,
        });
    });
});
