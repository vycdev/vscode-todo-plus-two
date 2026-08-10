import { expect } from 'chai';
import { getStatisticsLines, getStatisticsScopeEnd } from '../src/utils/statistics-lines';

describe('Statistics line ordering', () => {
    it('places each line context before tags on the same line', () => {
        const pending = { type: 'pending', lineNumber: 0 },
            pendingTag = { type: 'tag', lineNumber: 0 },
            comment = { type: 'comment', lineNumber: 1 },
            commentTag = { type: 'tag', lineNumber: 1 },
            project = { type: 'project', lineNumber: 2 },
            projectTag = { type: 'tag', lineNumber: 2 };

        const lines = getStatisticsLines({
            projects: [project],
            todosBox: [pending],
            comments: [comment],
            tags: [pendingTag, commentTag, projectTag],
        });

        expect(lines.map((line) => line.type)).to.deep.equal([
            'pending',
            'tag',
            'comment',
            'tag',
            'project',
            'tag',
        ]);
    });

    it('does not inherit pending state across a comment line', () => {
        const lines = getStatisticsLines({
            todosBox: [{ type: 'pending', lineNumber: 0 }],
            comments: [{ type: 'comment', lineNumber: 1 }],
            tags: [{ type: 'tag', lineNumber: 1 }],
        });

        let isPending = false;
        const tagStates: boolean[] = [];

        lines.forEach((line) => {
            if (line.type === 'tag') {
                tagStates.push(isPending);
            } else {
                isPending = line.type === 'pending';
            }
        });

        expect(tagStates).to.deep.equal([false]);
    });

    it('stops normal project statistics at a peer project', () => {
        const lines = [
                { type: 'project', level: 0 },
                { type: 'todo', level: 1 },
                { type: 'tag', level: 1 },
                { type: 'project', level: 0 },
                { type: 'todo', level: 1 },
            ],
            end = getStatisticsScopeEnd(
                lines,
                0,
                0,
                (line) => line.level,
                (line) => line.type === 'tag'
            );

        expect(lines.slice(1, end).map((line) => line.type)).to.deep.equal(['todo', 'tag']);
    });

    it('includes peer and nested projects through the end of an archive', () => {
        const lines = [
                { type: 'archive', level: 0 },
                { type: 'todo', level: 0 },
                { type: 'project', level: 0 },
                { type: 'todo', level: 1 },
                { type: 'project', level: 1 },
                { type: 'todo', level: 2 },
            ],
            end = getStatisticsScopeEnd(
                lines,
                0,
                0,
                (line) => line.level,
                (line) => line.type === 'tag',
                true
            );

        expect(lines.slice(1, end).map((line) => line.type)).to.deep.equal([
            'todo',
            'project',
            'todo',
            'project',
            'todo',
        ]);
    });
});
