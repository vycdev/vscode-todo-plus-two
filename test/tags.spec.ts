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

    it('removes configured tags before terminal punctuation', () => {
        expect(Tags.remove('Task @today, next', ['today'])).to.equal('Task, next');
        expect(Tags.remove('Task (@today).', ['today'])).to.equal('Task ().');
    });

    it('preserves longer tag names containing digits or punctuation', () => {
        const text = "Task @todo_extra @todo-bar @todo2 @todo.bar @todo:bar @todo's @todo @todoish";

        expect(Tags.remove(text, ['todo'])).to.equal(
            "Task @todo_extra @todo-bar @todo2 @todo.bar @todo:bar @todo's @todoish"
        );
    });

    it('preserves configured tags inside inline code', () => {
        const text = 'Task `@today` and `code @today(noon)` @today';

        expect(Tags.remove(text, ['today'])).to.equal('Task `@today` and `code @today(noon)`');
    });

    it('removes tags immediately after closing inline code delimiters', () => {
        expect(Tags.remove('Task `code`@today', ['today'])).to.equal('Task `code`');
        expect(Tags.removeAll('Task `code`@today')).to.equal('Task `code`');
    });

    it('matches inline code delimiters by backtick run length', () => {
        const text = 'Task ``code @today value`` @today';

        expect(Tags.remove(text, ['today'])).to.equal('Task ``code @today value``');
        expect(Tags.removeAll(text)).to.equal('Task ``code @today value``');
    });

    it('ignores different backtick runs inside a matching code span', () => {
        const text = 'Task ``code ` @today value`` @today';

        expect(Tags.remove(text, ['today'])).to.equal('Task ``code ` @today value``');
        expect(Tags.removeAll(text)).to.equal('Task ``code ` @today value``');
    });
});
