import { expect } from 'chai';
import { renderProjectCopy } from '../src/utils/project-copy';

const pkg = require('../package.json');

describe('Project copy', () => {
    const lines = [
        { text: 'First: @high', level: 0 },
        { text: '  ☐ Nested', level: 1 },
        { text: '  Child:', level: 1 },
        { text: '    ☐ Deeper', level: 2 },
        { text: '', level: 0 },
        { text: 'Second:', level: 0 },
        { text: '  ☐ Other', level: 1 },
    ];

    it('contributes and activates the copy command', () => {
        const command = pkg.contributes.commands.find(
            ({ command }) => command === 'todo.copyProjectWithStatistics'
        );

        expect(command).to.deep.include({
            command: 'todo.copyProjectWithStatistics',
            title: 'Todo: Copy Project with Statistics',
        });
        expect(pkg.activationEvents).to.include('onCommand:todo.copyProjectWithStatistics');
    });

    it('copies a project hierarchy and inserts statistics before project tags', () => {
        expect(renderProjectCopy(lines, 0, '(2/3)')).to.equal(
            'First: (2/3) @high\n  ☐ Nested\n  Child:\n    ☐ Deeper'
        );
    });

    it('preserves CRLF without copying blank separators before a peer project', () => {
        expect(renderProjectCopy(lines, 0, '(2/3)', '\r\n')).to.equal(
            'First: (2/3) @high\r\n  ☐ Nested\r\n  Child:\r\n    ☐ Deeper'
        );
    });

    it('can include peer projects through the end of an archive scope', () => {
        expect(renderProjectCopy(lines, 0, '(3/4)', '\n', true)).to.equal(
            'First: (3/4) @high\n' +
                '  ☐ Nested\n' +
                '  Child:\n' +
                '    ☐ Deeper\n\n' +
                'Second:\n' +
                '  ☐ Other'
        );
    });
});
