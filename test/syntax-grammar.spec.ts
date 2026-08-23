import { expect } from 'chai';

const pkg = require('../package.json');
const grammar = require('../syntax/grammar.tmLanguage.json');

function scopeForLine(line: string) {
    for (const pattern of grammar.patterns) {
        const rule = grammar.repository[pattern.include.slice(1)];

        if (rule.begin && new RegExp(rule.begin).test(line)) {
            return rule.name;
        }
    }
}

describe('Todo TextMate grammar', () => {
    it('is registered for Todo documents', () => {
        const contribution = pkg.contributes.grammars.find(
            ({ language, scopeName }) => language === 'todo' && scopeName === grammar.scopeName
        );

        expect(contribution.path).to.equal('./syntax/grammar.tmLanguage.json');
    });

    it('assigns minimap-visible scopes to each Todo line type', () => {
        expect(scopeForLine('Project:')).to.equal('markup.heading.todo');
        expect(scopeForLine('  ☐ pending')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('- [ ] markdown pending')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('☐ active @started(2026-01-01)')).to.equal('markup.changed.todo');
        expect(scopeForLine('✔ finished')).to.equal('markup.inserted.todo');
        expect(scopeForLine('- [x] markdown finished')).to.equal('markup.inserted.todo');
        expect(scopeForLine('☐ finished @done(2026-01-01)')).to.equal('markup.inserted.todo');
        expect(scopeForLine('☐ done wins @done @cancelled')).to.equal('markup.inserted.todo');
        expect(scopeForLine('✘ cancelled')).to.equal('markup.deleted.todo');
        expect(scopeForLine('☐ pending @donefoo')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('☐ pending @done2')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('☐ pending @cancelled2')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('☐ pending @started2')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('☐ explain `@done`')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('☐ explain `@cancelled`')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('☐ explain `@started`')).to.equal('markup.list.unchecked.todo');
        expect(scopeForLine('☐ explain ``a `literal` @done``')).to.equal(
            'markup.list.unchecked.todo'
        );
        expect(scopeForLine('☐ explain `@done` @started')).to.equal('markup.changed.todo');
        expect(scopeForLine('☐ explain `unfinished @done')).to.equal('markup.inserted.todo');
        expect(scopeForLine('- [~] unsupported cancelled box')).to.equal('comment.line.todo');
        expect(scopeForLine('plain comment')).to.equal('comment.line.todo');
    });

    it('provides standard inline scopes for themes to color', () => {
        expect(grammar.repository.code.name).to.equal('markup.inline.raw.todo');
        expect(grammar.repository.bold.name).to.equal('markup.bold.todo');
        expect(grammar.repository.italic.name).to.equal('markup.italic.todo');
        expect(grammar.repository.strikethrough.name).to.equal('markup.strikethrough.todo');
        expect(grammar.repository.tag.name).to.equal('entity.name.tag.todo');
        expect(grammar.repository.inline.patterns[0].include).to.equal('#code');
        expect(new RegExp(grammar.repository.tag.match).test('@due(2026-01-01)')).to.equal(true);
        expect(new RegExp(grammar.repository.tag.match).test('@link://example.com')).to.equal(true);
    });
});
