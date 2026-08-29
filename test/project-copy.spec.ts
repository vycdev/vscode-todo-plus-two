import { expect } from 'chai';
import { renderProjectCopy } from '../src/utils/project-copy';

const pkg = require('../package.json');

describe('Project copy', () => {
    const firstProjectHeaderEnd = 'First:'.length;
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
        expect(renderProjectCopy(lines, 0, '(2/3)', firstProjectHeaderEnd)).to.equal(
            'First: (2/3) @high\n  ☐ Nested\n  Child:\n    ☐ Deeper'
        );
    });

    it('preserves CRLF without copying blank separators before a peer project', () => {
        expect(renderProjectCopy(lines, 0, '(2/3)', firstProjectHeaderEnd, '\r\n')).to.equal(
            'First: (2/3) @high\r\n  ☐ Nested\r\n  Child:\r\n    ☐ Deeper'
        );
    });

    it('can include peer projects through the end of an archive scope', () => {
        expect(renderProjectCopy(lines, 0, '(3/4)', firstProjectHeaderEnd, '\n', true)).to.equal(
            'First: (3/4) @high\n' +
                '  ☐ Nested\n' +
                '  Child:\n' +
                '    ☐ Deeper\n\n' +
                'Second:\n' +
                '  ☐ Other'
        );
    });

    it('inserts statistics before a link tag containing a colon', () => {
        const taggedLines = [{ text: 'Project: @link://example.com', level: 0 }];

        expect(renderProjectCopy(taggedLines, 0, '(1/1)', 'Project:'.length)).to.equal(
            'Project: (1/1) @link://example.com'
        );
    });

    it('inserts statistics before a timestamp tag containing a colon', () => {
        const taggedLines = [{ text: 'Project: @due(2026-08-29 01:00)', level: 0 }];

        expect(renderProjectCopy(taggedLines, 0, '(1/1)', 'Project:'.length)).to.equal(
            'Project: (1/1) @due(2026-08-29 01:00)'
        );
    });

    it('uses the parsed delimiter for project names containing colons', () => {
        const taggedLines = [{ text: 'Release: Phase 1: @high', level: 0 }];

        expect(renderProjectCopy(taggedLines, 0, '(1/1)', 'Release: Phase 1:'.length)).to.equal(
            'Release: Phase 1: (1/1) @high'
        );
    });
});
