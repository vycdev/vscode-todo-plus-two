import { expect } from 'chai';
import {
    DependencyTarget,
    getDependencies,
    getIds,
    getUnresolvedIds,
    isValidId,
    normalizeId,
} from '../src/utils/dependencies';

function target(id: string, text: string): DependencyTarget {
    return {
        id,
        text,
        filePath: 'TODO',
        lineNumber: 0,
        start: 0,
        end: id.length,
        tagStart: 0,
        tagEnd: id.length,
    };
}

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

    it('requires every task sharing an ID to be finished', () => {
        const dependencies = getDependencies('☐ Deploy @depends(shared) @depends(missing)');
        const targets = {
            shared: [target('shared', 'done'), target('shared', 'open')],
        };

        expect(
            getUnresolvedIds(dependencies, targets, (item) => item.text === 'done')
        ).to.deep.equal(['shared', 'missing']);
    });

    it('validates and normalizes IDs before renaming', () => {
        expect(normalizeId(' release/v2 ')).to.equal('release/v2');
        expect(isValidId('release/v2')).to.equal(true);
        expect(isValidId('')).to.equal(false);
        expect(isValidId('release)')).to.equal(false);
    });
});
