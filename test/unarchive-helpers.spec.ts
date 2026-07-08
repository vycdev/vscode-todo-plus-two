import { expect } from 'chai';
import { unarchiveItemsFromSameFileContent } from '../src/utils/unarchive-helpers';

const options = {
    indentation: '  ',
    isFinishedTodo: (line: string) => /^\s*✔\s/.test(line),
    isComment: (line: string) => /^\s*-\s/.test(line),
    getProjectName: (line: string) => {
        const match = line.match(/^(\s*)([^:]+):\s*$/);
        return match ? match[2] : undefined;
    },
};

describe('unarchiveItemsFromSameFileContent', () => {
    it('restores a task and its attached comments to the bottom of its original project', () => {
        const content = [
            'Projects:',
            '  Client:',
            '    ☐ Existing task',
            '',
            'Archive:',
            '  Projects:',
            '    Client:',
            '      ✔ Restore build @done(2026-07-08)',
            '',
            '        - Restore this note too',
            '',
        ].join('\n');

        const result = unarchiveItemsFromSameFileContent(content, [7], 4, options);

        expect(result.count).to.equal(1);
        expect(result.content.split('\n')).to.deep.equal([
            'Projects:',
            '  Client:',
            '    ☐ Existing task',
            '    ✔ Restore build @done(2026-07-08)',
            '',
            '      - Restore this note too',
            '',
            'Archive:',
            '  Projects:',
            '    Client:',
            '',
        ]);
    });

    it('recreates a missing project chain before restoring the archived task', () => {
        const content = [
            'Inbox:',
            '  ☐ Existing task',
            '',
            'Archive:',
            '  Work:',
            '    Backend:',
            '      ✔ Restore service @done(2026-07-08)',
            '        - Restore its note',
        ].join('\n');

        const result = unarchiveItemsFromSameFileContent(content, [6], 3, options);

        expect(result.count).to.equal(1);
        expect(result.content.split('\n')).to.deep.equal([
            'Inbox:',
            '  ☐ Existing task',
            'Work:',
            '  Backend:',
            '    ✔ Restore service @done(2026-07-08)',
            '      - Restore its note',
            '',
            'Archive:',
            '  Work:',
            '    Backend:',
        ]);
    });

    it('ignores selected finished tasks outside the Archive section', () => {
        const content = ['Todo:', '  ✔ Keep in place', 'Archive:', '  ✔ Restore me'].join('\n');

        const result = unarchiveItemsFromSameFileContent(content, [1, 3], 2, options);

        expect(result.count).to.equal(1);
        expect(result.content.split('\n')).to.deep.equal([
            'Todo:',
            '  ✔ Keep in place',
            '✔ Restore me',
            'Archive:',
        ]);
    });
});
