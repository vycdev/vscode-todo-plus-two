import { expect } from 'chai';
import { getAutomaticSymbolRule } from '../src/utils/automatic_symbol';

describe('Automatic todo symbol insertion', () => {
    const symbols = {
        box: '☐',
        done: '✔',
        cancelled: '✘',
    };

    it('matches non-empty todo lines and preserves their indentation', () => {
        const rule = getAutomaticSymbolRule(symbols)!;

        ['☐ pending', '  ✔ done', '\t✘ cancelled', '  - [ ] markdown', '- [x] finished'].forEach(
            (line) => expect(rule.beforeText.test(line), line).to.equal(true)
        );
        expect(rule.appendText).to.equal('☐ ');
    });

    it('does not match empty todos or non-todo lines', () => {
        const rule = getAutomaticSymbolRule(symbols)!;

        ['☐ ', '  - [ ] ', 'Project:', '-- comment', 'plain text'].forEach((line) =>
            expect(rule.beforeText.test(line), line).to.equal(false)
        );
    });

    it('only applies when the cursor is at the end of the todo text', () => {
        const rule = getAutomaticSymbolRule(symbols)!;

        expect(rule.afterText.test('')).to.equal(true);
        expect(rule.afterText.test('  ')).to.equal(true);
        expect(rule.afterText.test('remaining text')).to.equal(false);
    });

    it('uses configured symbols for matching and insertion', () => {
        const rule = getAutomaticSymbolRule({ box: '[ ]', done: '[v]', cancelled: '[-]' })!;

        expect(rule.beforeText.test('  [ ] custom task')).to.equal(true);
        expect(rule.beforeText.test('[v] custom done')).to.equal(true);
        expect(rule.beforeText.test('[-] custom cancelled')).to.equal(true);
        expect(rule.appendText).to.equal('[ ] ');
    });

    it('disables the rule when the configured box symbol is empty', () => {
        expect(getAutomaticSymbolRule({ box: '', done: '✔', cancelled: '✘' })).to.equal(undefined);
    });
});
