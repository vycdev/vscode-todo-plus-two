import { expect } from 'chai';
import { updateEmbeddedDocumentCache } from '../src/utils/embedded/document-cache';

describe('Embedded document cache updates', () => {
    it('adds the first todo found in a document', () => {
        const filesData = {},
            nonEmptyFiles = new Set<string>(),
            data = [{ message: 'new todo' }];

        expect(
            updateEmbeddedDocumentCache(filesData, nonEmptyFiles, '/workspace/app.ts', data)
        ).to.equal(true);
        expect(filesData['/workspace/app.ts']).to.equal(data);
        expect(Array.from(nonEmptyFiles)).to.deep.equal(['/workspace/app.ts']);
    });

    it('replaces cached todos after a document edit', () => {
        const oldData = [{ message: 'old todo' }],
            newData = [{ message: 'updated todo' }],
            filesData = { '/workspace/app.ts': oldData },
            nonEmptyFiles = new Set(['/workspace/app.ts']);

        expect(
            updateEmbeddedDocumentCache(filesData, nonEmptyFiles, '/workspace/app.ts', newData)
        ).to.equal(true);
        expect(filesData['/workspace/app.ts']).to.equal(newData);
        expect(nonEmptyFiles.has('/workspace/app.ts')).to.equal(true);
    });

    it('removes a document after its last todo is deleted', () => {
        const filesData = { '/workspace/app.ts': [{ message: 'old todo' }] },
            nonEmptyFiles = new Set(['/workspace/app.ts']);

        expect(
            updateEmbeddedDocumentCache(filesData, nonEmptyFiles, '/workspace/app.ts', [])
        ).to.equal(true);
        expect(filesData).to.not.have.property('/workspace/app.ts');
        expect(nonEmptyFiles.has('/workspace/app.ts')).to.equal(false);
    });

    it('removes a pending cache entry when an edit contains no todos', () => {
        const filesData = { '/workspace/app.ts': undefined },
            nonEmptyFiles = new Set<string>();

        expect(
            updateEmbeddedDocumentCache(filesData, nonEmptyFiles, '/workspace/app.ts', [])
        ).to.equal(true);
        expect(filesData).to.not.have.property('/workspace/app.ts');
        expect(nonEmptyFiles.size).to.equal(0);
    });

    it('does not add empty documents that were never cached', () => {
        const filesData = {},
            nonEmptyFiles = new Set<string>();

        expect(
            updateEmbeddedDocumentCache(filesData, nonEmptyFiles, '/workspace/app.ts', [])
        ).to.equal(false);
        expect(filesData).to.deep.equal({});
        expect(nonEmptyFiles.size).to.equal(0);
    });
});
