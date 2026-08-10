import { expect } from 'chai';
import { maskInlineCode, matchesTodoStatus, removeTodoStatusTag } from '../src/utils/todo-status';

describe('Todo status matching', () => {
    const finishedTag = /(?:^|[^a-zA-Z0-9])@(?:done|cancelled)(?=\(|\W|$)/;

    it('ignores finished tags inside inline code', () => {
        expect(matchesTodoStatus('☐ Explain `@done`', finishedTag)).to.equal(false);
        expect(matchesTodoStatus('☐ Explain `@cancelled(reason)`', finishedTag)).to.equal(false);
    });

    it('still recognizes finished tags outside inline code', () => {
        expect(matchesTodoStatus('☐ Explain `code` @done', finishedTag)).to.equal(true);
        expect(matchesTodoStatus('☐ Explain `code` @cancelled(reason)', finishedTag)).to.equal(
            true
        );
    });

    it('matches inline code delimiters by backtick run length', () => {
        const text = '☐ Explain ``a `literal` @done value`` @cancelled(reason)';
        const masked = maskInlineCode(text);

        expect(masked).to.have.length(text.length);
        expect(masked).not.to.include('@done');
        expect(masked).to.include('@cancelled(reason)');
        expect(matchesTodoStatus(text, finishedTag)).to.equal(true);
    });

    it('does not mask text after an unmatched backtick run', () => {
        const text = '☐ Explain `unfinished @done';

        expect(maskInlineCode(text)).to.equal(text);
        expect(matchesTodoStatus(text, finishedTag)).to.equal(true);
    });

    it('removes real status tags without changing inline examples', () => {
        const tagFinished = /(?:^|[^a-zA-Z0-9])@(?:done|cancelled)(?:\([^)]*\))?/;

        expect(removeTodoStatusTag('☐ Explain `@done` @cancelled(reason)', tagFinished)).to.equal(
            '☐ Explain `@done`'
        );
        expect(removeTodoStatusTag('☐ Explain `@done`', tagFinished)).to.equal('☐ Explain `@done`');
    });
});
