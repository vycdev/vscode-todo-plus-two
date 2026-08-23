import { expect } from 'chai';
import stringMatches from 'string-matches';
import {
    capturedReservedTagArgumentOrBoundary,
    createTagRegexes,
    reservedTagArgumentOrBoundary,
} from '../src/utils/tag-regexes';

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

    it('matches normal tags that begin with reserved tag names', () => {
        const regexes = createTagRegexes(['high']);

        expect(regexes.tagNormal.test('@doneSoon')).to.equal(true);
        expect(regexes.tagNormal.test('@createdAt')).to.equal(true);
        expect(regexes.tagNormal.test('@highway')).to.equal(true);
        expect(regexes.tagNormal.test('@done2')).to.equal(true);
        expect(regexes.tagNormal.test('@created2')).to.equal(true);
        expect(regexes.tagNormal.test('@high2')).to.equal(true);
        expect(regexes.tagSpecial.test('@high2')).to.equal(false);
        expect(stringMatches('@high2', regexes.tagSpecialNormal).map(matchedTag)).to.deep.equal([
            '@high2',
        ]);
    });

    it('still excludes reserved tags and their arguments', () => {
        const regexes = createTagRegexes(['high']);

        expect(regexes.tagNormal.test('@done')).to.equal(false);
        expect(regexes.tagNormal.test('@done(today)')).to.equal(false);
        expect(regexes.tagNormal.test('@high')).to.equal(false);
        expect(regexes.tagNormal.test('@high(value)')).to.equal(false);
        expect(regexes.tagNormal.test('@2h')).to.equal(false);
    });

    it('uses alphanumeric boundaries for reserved status and time tags', () => {
        const statusTag = new RegExp(`@(?:done|cancelled)${reservedTagArgumentOrBoundary}`),
            timestampTag = new RegExp(`@started${capturedReservedTagArgumentOrBoundary}`);

        expect(statusTag.test('@done')).to.equal(true);
        expect(statusTag.test('@cancelled(reason)')).to.equal(true);
        expect(statusTag.test('@done2')).to.equal(false);
        expect(timestampTag.test('@started')).to.equal(true);
        expect(timestampTag.test('@started(value)')).to.equal(true);
        expect(timestampTag.test('@started2')).to.equal(false);
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
