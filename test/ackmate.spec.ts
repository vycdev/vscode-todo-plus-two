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

    it('ignores match records that precede their file path', () => {
        const output = ['2:orphan result', 'src/tasks.ts', '4:TODO real'].join('\n');

        expect(Ackmate.parse(output)).to.deep.equal([
            {
                filePath: 'src/tasks.ts',
                lineNr: 3,
                line: 'TODO real',
            },
        ]);
    });
});
