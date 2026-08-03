import { expect } from 'chai';
import {
    getTagArgumentCompletions,
    getTagArgumentPrefix,
    getTagArguments,
    getTagNames,
} from '../src/utils/tag_completions';

describe('Tag completion utilities', () => {
    it('collapses argument values into unique tag names', () => {
        expect(
            getTagNames(['@note(one)', '@note(two)', '@now', '@NOTE(three)', '@note(one)'])
        ).to.deep.equal(['@note', '@now']);
    });

    it('returns argument values only for the active tag name', () => {
        expect(
            getTagArguments(
                ['@note(one)', '@note(two)', '@other(value)', '@note', '@NOTE(three)'],
                '@note'
            )
        ).to.deep.equal(['@note(one)', '@note(two)', '@NOTE(three)']);
    });

    it('keeps argument completion active when the tag has no known values', () => {
        const prefix = getTagArgumentPrefix('Task @newtag(', 13);

        expect(getTagArgumentCompletions(['@other(value)'], prefix)).to.deep.equal([]);
    });

    it('detects a partially typed tag argument before the cursor', () => {
        expect(getTagArgumentPrefix('Task @note(con', 14)).to.deep.equal({
            text: '@note(con',
            name: '@note',
            start: 5,
            end: 14,
        });
    });

    it('does not treat a completed or embedded tag as an active argument', () => {
        expect(getTagArgumentPrefix('Task @note(content)', 19)).to.equal(undefined);
        expect(getTagArgumentPrefix('email@example.com(', 18)).to.equal(undefined);
    });

    it('does not complete before an existing closing parenthesis', () => {
        expect(getTagArgumentPrefix('Task @note(con)', 14)).to.equal(undefined);
    });

    it('ignores tag argument prefixes inside inline code', () => {
        const inlineCode = '`Task @note(con`';
        const afterInlineCode = '`Task` @note(con';

        expect(getTagArgumentPrefix(inlineCode, inlineCode.length - 1)).to.equal(undefined);
        expect(getTagArgumentPrefix(inlineCode, inlineCode.length)).to.equal(undefined);
        expect(getTagArgumentPrefix(afterInlineCode, afterInlineCode.length)).to.deep.equal({
            text: '@note(con',
            name: '@note',
            start: 7,
            end: 16,
        });
    });
});
