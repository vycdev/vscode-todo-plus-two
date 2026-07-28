import { expect } from 'chai';
import { hasEmbeddedMatch } from '../src/utils/embedded/regex';

const pkg = require('../package.json');

describe('Embedded todo regex defaults', () => {
    function match(line: string) {
        const properties = pkg.contributes.configuration.properties,
            pattern = properties['todo.embedded.regex'].default,
            flags = properties['todo.embedded.regexFlags'].default,
            regex = new RegExp(pattern, flags);

        return regex.exec(line);
    }

    it('preserves plain double hyphens in todo messages', () => {
        const result = match('# TODO keep this -- and this too');

        expect(result && result[1]).to.equal('TODO');
        expect(result && result[2]).to.equal(' keep this -- and this too');
    });

    it('stops before HTML and Handlebars closing markers', () => {
        const html = match('<!-- TODO keep this -->'),
            handlebars = match('-- TODO keep this --}}');

        expect(html && html[2]).to.equal(' keep this');
        expect(handlebars && handlebars[2]).to.equal(' keep this');
    });

    it('matches inline Liquid comment tags', () => {
        const standard = match('{% comment %} TODO: update the product copy {% endcomment %}'),
            whitespaceTrimmed = match(
                '{%- comment -%} FIXME: update the product copy {%- endcomment -%}'
            );

        expect(standard && standard[1]).to.equal('TODO');
        expect(standard && standard[2]).to.equal(' update the product copy');
        expect(whitespaceTrimmed && whitespaceTrimmed[1]).to.equal('FIXME');
        expect(whitespaceTrimmed && whitespaceTrimmed[2]).to.equal(' update the product copy');
    });

    it('does not treat Liquid output tags as comments', () => {
        expect(match("{% assign note = 'TODO: update the product copy' %}")).to.equal(null);
    });

    ['ag', 'rg'].forEach((provider) => {
        it(`includes Liquid comments in the ${provider} candidate regex`, () => {
            const properties = pkg.contributes.configuration.properties,
                pattern = properties[`todo.embedded.providers.${provider}.regex`].default,
                regex = new RegExp(pattern, 'i');

            expect(
                regex.test('{% comment %} TODO: update the product copy {% endcomment %}')
            ).to.equal(true);
        });
    });
});

describe('Embedded todo scan pre-check', () => {
    it('recognizes custom markers outside the built-in marker list', () => {
        const regex = /^\/\/\s*(TASK):?\s*(.*)$/gi,
            content = ['const ready = true;', '  // TASK ship it'].join('\n');

        expect(hasEmbeddedMatch(content, regex)).to.equal(true);
        expect(hasEmbeddedMatch('// TODO ignored', regex)).to.equal(false);
    });
});
