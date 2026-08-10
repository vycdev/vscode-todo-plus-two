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

    it('keeps unfinished tag arguments on their current line', () => {
        const text = 'Task @custom(value\nProject:\n  ☐ child)';
        const regexes = createTagRegexes(['high']);
        const matches = stringMatches(text, regexes.tagSpecialNormal);
        const normalMatch = regexes.tagNormal.exec(text);
        const specialMatch = regexes.tagSpecial.exec(text.replace('@custom', '@high'));

        expect(matches.map(matchedTag)).to.deep.equal(['@custom']);
        expect(matches[0][0]).not.to.match(/[\r\n]/);
        expect(normalMatch && normalMatch[0]).not.to.match(/[\r\n]/);
        expect(specialMatch && specialMatch[0]).not.to.match(/[\r\n]/);
    });
});
