import { expect } from 'chai';
import Ackmate from '../src/utils/ackmate';

describe('Ackmate parser', () => {
    it('preserves numeric-leading file paths', () => {
        const output = [
            '123/tasks/file.ts',
            '2:TODO first',
            '9;4 5:FIXME second',
            'C:\\workspace\\other.ts',
            '3:TODO third',
        ].join('\r\n');

        expect(Ackmate.parse(output)).to.deep.equal([
            {
                filePath: '123/tasks/file.ts',
                lineNr: 1,
                line: 'TODO first',
            },
            {
                filePath: '123/tasks/file.ts',
                lineNr: 8,
                line: 'FIXME second',
            },
            {
                filePath: 'C:/workspace/other.ts',
                lineNr: 2,
                line: 'TODO third',
            },
        ]);
    });

    it('parses records separated by classic Mac line endings', () => {
        expect(Ackmate.parse('TODO.md\r2:TODO first\r3:FIXME second')).to.deep.equal([
            {
                filePath: 'TODO.md',
                lineNr: 1,
                line: 'TODO first',
            },
            {
                filePath: 'TODO.md',
                lineNr: 2,
                line: 'FIXME second',
            },
        ]);
    });
});
