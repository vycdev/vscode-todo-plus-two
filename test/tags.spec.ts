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

    it('removes all tags for presentation while preserving surrounding text', () => {
        expect(Tags.removeAll('☐ Task @today @done(2026-07-02)')).to.equal('☐ Task');
        expect(Tags.removeAll('☐ @high Task')).to.equal('☐ Task');
        expect(Tags.removeAll('☐ Contact user@example.com')).to.equal('☐ Contact user@example.com');
        expect(Tags.removeAll('Project: @work')).to.equal('Project:');
        expect(Tags.removeAll('☐ Task (@work), [@today]')).to.equal('☐ Task (), []');
        expect(Tags.removeAll('☐ First, @work, next')).to.equal('☐ First, next');
        expect(Tags.removeAll('☐ See `code @tag` @https://example.com')).to.equal(
            '☐ See `code @tag`'
        );
    });
});
