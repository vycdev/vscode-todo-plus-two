import { expect } from 'chai';
import { AutoCompleteLine, getAutoCompletableParentLines } from '../src/utils/auto-complete';

describe('Automatic parent completion', () => {
    const line = (
        lineNumber: number,
        level: number,
        status?: AutoCompleteLine['status'],
        isProject = false
    ): AutoCompleteLine => ({ lineNumber, level, status, isProject });

    it('completes parents from the deepest level upwards', () => {
        const lines = [line(0, 0, 'box'), line(1, 1, 'box'), line(2, 2, 'done')];

        expect(getAutoCompletableParentLines(lines, [2])).to.deep.equal([1, 0]);
    });

    it('waits until every nested todo is done', () => {
        const lines = [line(0, 0, 'box'), line(1, 1, 'done'), line(2, 1, 'box')];

        expect(getAutoCompletableParentLines(lines, [1])).to.deep.equal([]);
    });

    it('does not count cancelled todos as done', () => {
        const lines = [line(0, 0, 'box'), line(1, 1, 'done'), line(2, 1, 'cancelled')];

        expect(getAutoCompletableParentLines(lines, [1])).to.deep.equal([]);
    });

    it('allows comments between nested todo levels', () => {
        const lines = [line(0, 0, 'box'), line(1, 1), line(2, 2, 'done')];

        expect(getAutoCompletableParentLines(lines, [2])).to.deep.equal([0]);
    });

    it('does not cross a project boundary', () => {
        const lines = [line(0, 0, 'box'), line(1, 0, undefined, true), line(2, 1, 'done')];

        expect(getAutoCompletableParentLines(lines, [2])).to.deep.equal([]);
    });

    it('does not cross an indented project boundary', () => {
        const lines = [line(0, 0, 'box'), line(1, 1, undefined, true), line(2, 2, 'done')];

        expect(getAutoCompletableParentLines(lines, [2])).to.deep.equal([]);
    });

    it('keeps dependency-blocked parents and their ancestors open', () => {
        const lines = [line(0, 0, 'box'), line(1, 1, 'box'), line(2, 2, 'done')];

        expect(getAutoCompletableParentLines(lines, [2], [1])).to.deep.equal([]);
        expect(getAutoCompletableParentLines(lines, [2], [0])).to.deep.equal([1]);
    });

    it('ignores triggers that are not currently done', () => {
        const lines = [line(0, 0, 'box'), line(1, 1, 'box')];

        expect(getAutoCompletableParentLines(lines, [1])).to.deep.equal([]);
    });
});
