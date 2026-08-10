import { expect } from 'chai';
import { DocumentLinesCache } from '../src/todo/decorators/document-lines-cache';

describe('document decoration line cache', () => {
    it('keeps snapshots separate for each document', () => {
        const cache = new DocumentLinesCache();
        let firstText = 'First:\n  ☐ one';
        let secondText = 'Second:\n  ☐ two';
        const firstDocument = { getText: () => firstText },
            secondDocument = { getText: () => secondText };

        cache.update(firstDocument);
        cache.update(secondDocument);

        expect(cache.get(firstDocument)).to.deep.equal(['First:', '  ☐ one']);
        expect(cache.get(secondDocument)).to.deep.equal(['Second:', '  ☐ two']);

        firstText = 'First:\n  ✔ one';
        cache.update(firstDocument);

        expect(cache.get(firstDocument, 1)).to.equal('  ✔ one');
        expect(cache.get(secondDocument, 1)).to.equal('  ☐ two');
    });

    it('detects changes against the cached document snapshot', () => {
        const cache = new DocumentLinesCache();
        let text = 'Todo:\n  ☐ item';
        const textDocument = { getText: () => text };

        cache.update(textDocument);
        expect(cache.didChange({ textDocument })).to.equal(false);

        text = 'Todo:\n  ✔ item';
        expect(cache.didChange({ textDocument })).to.equal(true);
    });
});
