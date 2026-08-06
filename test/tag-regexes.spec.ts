import { expect } from 'chai';
import stringMatches from 'string-matches';
import { createTagRegexes } from '../src/utils/tag-regexes';

const matchedTag = (match: RegExpMatchArray): string | undefined => {
    return match.slice(1).filter(Boolean).pop();
};

describe('Tag regexes', () => {
    it('matches normal tags when no special tag names are configured', () => {
        const regexes = createTagRegexes([]);
        const matches = stringMatches('Task @custom and @other(value)', regexes.tagSpecialNormal);

        expect(matches.map(matchedTag)).to.deep.equal(['@custom', '@other(value)']);
        expect(regexes.tagSpecialNormal.exec('plain text')).to.equal(null);
        expect(regexes.tagNormal.test('@custom')).to.equal(true);
        expect(regexes.tagSpecial.test('@custom')).to.equal(false);
    });

    it('keeps configured special tags separate from normal tags', () => {
        const regexes = createTagRegexes(['high']);

        expect(regexes.tagSpecial.test('@high')).to.equal(true);
        expect(regexes.tagNormal.test('@high')).to.equal(false);
        expect(regexes.tagNormal.test('@custom')).to.equal(true);
    });
});
