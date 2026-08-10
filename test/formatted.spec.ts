import { expect } from 'chai';
import stringMatches from 'string-matches';
import { formattingRegexes } from '../src/utils/formatting';

function getFormattedText(text: string) {
    return stringMatches(text, formattingRegexes.formatted).map((match) => {
        return match.slice(1, 5).filter(Boolean)[0];
    });
}

describe('Todo inline formatting', () => {
    it('recognizes supported single-delimiter formatting', () => {
        expect(getFormattedText('☐ `code` *bold* _italic_ ~struck~')).to.deep.equal([
            '`code`',
            '*bold*',
            '_italic_',
            '~struck~',
        ]);
    });

    it('does not partially match repeated delimiter runs', () => {
        expect(getFormattedText('☐ ``code`` **bold** __italic__ ~~struck~~')).to.deep.equal([]);
    });

    it('keeps valid formatting next to repeated delimiter runs', () => {
        expect(
            getFormattedText('☐ **ignored** and *bold*; ~~ignored~~ and ~struck~')
        ).to.deep.equal(['*bold*', '~struck~']);
    });

    it('preserves outer formatting around other delimiter characters', () => {
        expect(getFormattedText('*`code`* _*bold*_ ~_italic_~')).to.deep.equal([
            '*`code`*',
            '_*bold*_',
            '~_italic_~',
        ]);
    });

    it('rejects repeated runs in the type-specific formatting regexes', () => {
        expect(stringMatches('``code``', formattingRegexes.formattedCode)).to.deep.equal([]);
        expect(stringMatches('**bold**', formattingRegexes.formattedBold)).to.deep.equal([]);
        expect(stringMatches('__italic__', formattingRegexes.formattedItalic)).to.deep.equal([]);
        expect(stringMatches('~~struck~~', formattingRegexes.formattedStrikethrough)).to.deep.equal(
            []
        );
    });

    it('recognizes adjacent distinct formatting spans (delimiter-specific boundaries)', () => {
        expect(getFormattedText('*bold*_italic_')).to.deep.equal(['*bold*', '_italic_']);
        expect(getFormattedText('*bold*~struck~')).to.deep.equal(['*bold*', '~struck~']);
        expect(getFormattedText('_italic_`code`')).to.deep.equal(['_italic_', '`code`']);
        expect(getFormattedText('~struck~*bold*')).to.deep.equal(['~struck~', '*bold*']);
    });

    it('recognizes formatting adjacent to punctuation and whitespace', () => {
        expect(getFormattedText('*bold*,_italic_')).to.deep.equal(['*bold*', '_italic_']);
        expect(getFormattedText('*bold* _italic_')).to.deep.equal(['*bold*', '_italic_']);
        expect(getFormattedText('(*bold*)[_italic_]')).to.deep.equal(['*bold*', '_italic_']);
    });
});
