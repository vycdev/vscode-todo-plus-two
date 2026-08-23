import Due from './due';
import { maskInlineCode } from './todo-status';

export interface DueTaskLine {
    date: Date;
    dateKey: string;
    lineNumber: number;
    status: string;
    text: string;
}

const matches = (text: string, regex: RegExp): boolean => {
    regex.lastIndex = 0;

    return regex.test(text);
};

export const getDueDateKey = (date: Date): string => {
    const month = `${date.getMonth() + 1}`.padStart(2, '0'),
        day = `${date.getDate()}`.padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
};

export const getDueTaskLines = (
    lines: string[],
    todoRegex: RegExp,
    finishedRegex: RegExp,
    today: Date = new Date(),
    soonDays: number = 7
): DueTaskLine[] => {
    const tasks: DueTaskLine[] = [];

    lines.forEach((text, lineNumber) => {
        const maskedText = maskInlineCode(text);

        if (!matches(maskedText, todoRegex) || matches(maskedText, finishedRegex)) return;

        const tags = maskedText.match(/@due\([^)]*\)/gi) || [];

        for (const tag of tags) {
            const value = Due.extract(tag),
                date = Due.parse(value);

            if (!date) continue;

            tasks.push({
                date,
                dateKey: getDueDateKey(date),
                lineNumber,
                status: Due.status(value, today, soonDays),
                text,
            });
            break;
        }
    });

    return tasks.sort((a, b) => a.date.getTime() - b.date.getTime() || a.lineNumber - b.lineNumber);
};
