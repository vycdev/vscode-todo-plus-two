import { expect } from 'chai';
import { loadAvailableDocuments } from '../src/utils/document-loader';

describe('Document loader', () => {
    it('keeps readable documents when another document cannot be opened', async () => {
        const failures: string[] = [];
        const documents = await loadAvailableDocuments(
            ['first.todo', 'deleted.todo', 'last.todo'],
            async (filePath) => {
                if (filePath === 'deleted.todo') throw new Error('file not found');

                return { filePath };
            },
            (filePath) => failures.push(filePath)
        );

        expect(documents).to.deep.equal([{ filePath: 'first.todo' }, { filePath: 'last.todo' }]);
        expect(failures).to.deep.equal(['deleted.todo']);
    });
});
