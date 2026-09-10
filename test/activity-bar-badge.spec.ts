import { expect } from 'chai';
import {
    countPendingTodos,
    getActivityBarBadge,
    supportsActivityBarBadge,
    updateActivityBarBadge,
} from '../src/utils/activity-bar-badge';

const document = (lines: string[]) => ({
    lineCount: lines.length,
    lineAt: (lineNumber: number) => ({ text: lines[lineNumber] }),
});

describe('Activity bar badge', () => {
    it('counts pending todos across loaded Todo files', () => {
        const filesData = {
            '/workspace/TODO': {
                textEditor: document(['Project:', '  ☐ first', '  ✔ done']),
            },
            '/workspace/next.todo': {
                textEditor: document(['☐ second', 'A comment']),
            },
            '/workspace/loading.todo': undefined,
        };

        expect(countPendingTodos(filesData, /^\s*☐\s/)).to.equal(2);
    });

    it('creates a singular or plural badge and hides zero', () => {
        expect(getActivityBarBadge(0)).to.equal(undefined);
        expect(getActivityBarBadge(1)).to.deep.equal({
            value: 1,
            tooltip: '1 pending todo',
        });
        expect(getActivityBarBadge(2)).to.deep.equal({
            value: 2,
            tooltip: '2 pending todos',
        });
    });

    it('updates supported tree views without affecting older VS Code versions', () => {
        const supported = { badge: undefined };
        const unsupported = {};

        expect(supportsActivityBarBadge(supported)).to.equal(true);
        expect(supportsActivityBarBadge(unsupported)).to.equal(false);
        expect(updateActivityBarBadge(supported, 2)).to.equal(true);
        expect(supported.badge).to.deep.equal({ value: 2, tooltip: '2 pending todos' });
        expect(updateActivityBarBadge(supported, 0)).to.equal(true);
        expect(supported.badge).to.equal(undefined);
        expect(updateActivityBarBadge(unsupported, 2)).to.equal(false);
        expect(unsupported).to.deep.equal({});
    });
});
