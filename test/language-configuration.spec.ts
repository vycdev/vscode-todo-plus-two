import { expect } from 'chai';

const pkg = require('../package.json');
const languageConfig = require('../language-configuration.json');

describe('Todo language configuration', () => {
  it('registers a bold surrounding pair for selected text', () => {
    const todoLanguage = pkg.contributes.languages.find(({ id }) => id === 'todo');

    expect(todoLanguage.configuration).to.equal('./language-configuration.json');
    expect(languageConfig.surroundingPairs).to.deep.include(['*', '*']);
  });

  it('recognizes standalone region markers when using indentation folding', () => {
    const start = new RegExp(languageConfig.folding.markers.start);
    const end = new RegExp(languageConfig.folding.markers.end);

    ['@region', '  @region  ', '\t@region'].forEach((line) => {
      expect(start.test(line), line).to.equal(true);
    });
    ['@endregion', '  @endregion  ', '\t@endregion'].forEach((line) => {
      expect(end.test(line), line).to.equal(true);
    });
    ['☐ task @region', '@region-name', '@region(label)', '`@region`', '@region extra'].forEach(
      (line) => expect(start.test(line), line).to.equal(false)
    );
    ['☐ task @endregion', '@endregion-name', '`@endregion`', '@endregion extra'].forEach((line) =>
      expect(end.test(line), line).to.equal(false)
    );
  });
});
