import { expect } from 'chai';
import Tags from '../src/utils/tags';

describe('Tag utilities', () => {
    it('removes configured tags while preserving other tags', () => {
        const text = 'Task @today @done(2026-07-02) @high';

        expect(Tags.remove(text, ['today'])).to.equal('Task @done(2026-07-02) @high');
    });

    it('supports @ prefixes and tag arguments without removing longer tag names', () => {
        const text = 'Task @today(noon) @high @todayish @done';

        expect(Tags.remove(text, ['@today', 'high'])).to.equal('Task @todayish @done');
    });
});
