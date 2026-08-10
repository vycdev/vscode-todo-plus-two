import { expect } from 'chai';
import { getFoldingRanges } from '../src/utils/folding';

const isProject = (line: string) => /^\s*[^☐✔✘]+:\s*$/.test(line);

describe('Todo folding ranges', () => {
    it('leaves trailing blank lines outside folded project blocks', () => {
        const lines = [
            'Project One:',
            '  ☐ task',
            '  details',
            '',
            '',
            'Project Two:',
            '  ☐ another task',
        ];

        expect(getFoldingRanges(lines, isProject)).to.deep.equal([
            { start: 0, end: 2 },
            { start: 5, end: 6 },
        ]);
    });

    it('keeps nested projects foldable without consuming their following separator', () => {
        const lines = [
            'Root:',
            '  ☐ first',
            '  Child:',
            '    ☐ nested',
            '',
            '  ☐ last',
            '',
            'Next:',
            '  ☐ next task',
        ];

        expect(getFoldingRanges(lines, isProject)).to.deep.equal([
            { start: 0, end: 5 },
            { start: 2, end: 3 },
            { start: 7, end: 8 },
        ]);
    });

    it('does not create a range for an empty project', () => {
        expect(getFoldingRanges(['Empty:', '', 'Next:'], isProject)).to.deep.equal([]);
    });

    it('compares tabs and spaces using the configured tab size', () => {
        const lines = ['Root:', '\tChild:', '\t  ☐ nested', '    Sibling:', '        ☐ task'];

        expect(getFoldingRanges(lines, isProject, 4)).to.deep.equal([
            { start: 0, end: 4 },
            { start: 1, end: 2 },
            { start: 3, end: 4 },
        ]);
    });
});
