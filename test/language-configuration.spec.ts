import { expect } from 'chai';

const pkg = require('../package.json');
const languageConfig = require('../language-configuration.json');

describe('Todo language configuration', () => {
    it('registers a bold surrounding pair for selected text', () => {
        const todoLanguage = pkg.contributes.languages.find(({ id }) => id === 'todo');

        expect(todoLanguage.configuration).to.equal('./language-configuration.json');
        expect(languageConfig.surroundingPairs).to.deep.include(['*', '*']);
    });
});
