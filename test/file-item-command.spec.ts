import { expect } from 'chai';
import { getFileOpenCommand } from '../src/views/items/file-command';

describe('Todo file tree items', () => {
    it('creates an Open command targeting the file item', () => {
        const item = { resourceUri: { fsPath: '/workspace/TODO' } };

        expect(getFileOpenCommand(item)).to.deep.equal({
            title: 'Open',
            command: 'todo.viewOpenFile',
            arguments: [item],
        });
    });
});
