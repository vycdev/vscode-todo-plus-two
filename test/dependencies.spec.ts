import { expect } from 'chai';
import { getDependencies, getIds } from '../src/utils/dependencies';

describe('Task dependencies', () => {
    it('accepts readable IDs with spaces and punctuation', () => {
        const references = getIds(
            '  ☐ Release the API @id(release/v2: candidate A & B) @id(δelta)'
        );

        expect(references.map((reference) => reference.id)).to.deep.equal([
            'release/v2: candidate A & B',
            'δelta',
        ]);
    });

    it('normalizes surrounding whitespace in IDs and dependencies', () => {
        const ids = getIds('☐ Source task @id( source task )');
        const dependencies = getDependencies('☐ Dependent task @depends( source task )');

        expect(ids[0].id).to.equal('source task');
        expect(dependencies[0].id).to.equal('source task');
        expect(dependencies[0].tagEnd - dependencies[0].tagStart).to.equal(
            '@depends( source task )'.length
        );
    });

    it('finds every dependency on a task and ignores empty references', () => {
        const dependencies = getDependencies(
            '☐ Ship @depends(api contract) @depends(release/v2) @depends()'
        );

        expect(dependencies.map((reference) => reference.id)).to.deep.equal([
            'api contract',
            'release/v2',
        ]);
    });

    it('preserves every duplicate ID for the link picker to resolve', () => {
        const ids = getIds('☐ First @id(test) ☐ Second @id(test) ☐ Third @id(test)');

        expect(ids.map((reference) => reference.id)).to.deep.equal(['test', 'test', 'test']);
    });
});
