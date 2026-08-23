import { expect } from 'chai';
import { getDueDateKey, getDueTaskLines } from '../src/utils/due_tasks';

const todoRegex = /^\s*(?:☐|✔|✘)\s/;
const finishedRegex =
    /^\s*(?:✔|✘)\s|^\s*☐\s.*[^a-zA-Z0-9]@(?:done|cancelled)(?:(?:\([^)]*\))|(?![a-zA-Z]))/;

describe('Due task lines', () => {
    const today = new Date(2026, 6, 2);

    it('collects and sorts unfinished tasks with valid due tags', () => {
        const tasks = getDueTaskLines(
            [
                '  ☐ Later @due(2026-07-10)',
                '  ✔ Finished @due(2026-07-01)',
                '  ☐ Missing date',
                '  ☐ Today @due(2026-07-02)',
                '  ☐ Invalid @due(not-a-real-date)',
            ],
            todoRegex,
            finishedRegex,
            today
        );

        expect(tasks.map((task) => task.text)).to.deep.equal([
            '  ☐ Today @due(2026-07-02)',
            '  ☐ Later @due(2026-07-10)',
        ]);
        expect(tasks.map((task) => task.status)).to.deep.equal(['today', 'later']);
    });

    it('uses local calendar dates for view groups', () => {
        expect(getDueDateKey(new Date(2026, 0, 9, 23, 30))).to.equal('2026-01-09');
    });

    it('uses the first valid due tag on a task', () => {
        const tasks = getDueTaskLines(
            ['☐ Release @due(invalid) @due(2026-07-03)'],
            todoRegex,
            finishedRegex,
            today
        );

        expect(tasks).to.have.length(1);
        expect(tasks[0].dateKey).to.equal('2026-07-03');
    });

    it('ignores inline-code status and due tags', () => {
        const tasks = getDueTaskLines(
            ['☐ Explain `@done` @due(2026-08-10)', '☐ Explain `@due(2026-08-10)`'],
            todoRegex,
            finishedRegex,
            today
        );

        expect(tasks).to.have.length(1);
        expect(tasks[0].text).to.equal('☐ Explain `@done` @due(2026-08-10)');
        expect(tasks[0].dateKey).to.equal('2026-08-10');
    });
});
