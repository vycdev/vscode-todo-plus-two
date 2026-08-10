/* IMPORT */

import * as moment from 'moment';
import Time from './time';

/* TYPES */

export interface TimerState {
    startedDate: Date;
    toggleDates: Date[];
    active: boolean;
    elapsedMilliseconds: number;
}

/* HELPERS */

const parseTagDate = (
    value: string,
    format: string,
    timestampOffset: number = 0
): Date | undefined => {
    if (!value) return;

    const parsed = moment(value, format, true);

    if (!parsed.isValid()) return;

    return new Date(parsed.valueOf() + timestampOffset);
};

interface ParsedTagDate {
    date: Date;
    end: number;
}

const isInsideInlineCode = (text: string, offset: number): boolean => {
    const runs = text.slice(0, offset).match(/`+/g) || [];
    let delimiterLength = 0;

    runs.forEach((run) => {
        if (!delimiterLength) {
            delimiterLength = run.length;
        } else if (run.length === delimiterLength) {
            delimiterLength = 0;
        }
    });

    return delimiterLength > 0;
};

const findTagDates = (
    text: string,
    tag: string,
    format: string,
    timestampOffset: number = 0,
    startIndex: number = 0
): ParsedTagDate[] => {
    const regex = new RegExp(`@${tag}\\(([^)]*)\\)`, 'g'),
        matches: ParsedTagDate[] = [];

    regex.lastIndex = startIndex;

    let match: RegExpExecArray;

    while ((match = regex.exec(text))) {
        if (match.index > 0 && /[a-zA-Z0-9`]/.test(text[match.index - 1])) continue;
        if (isInsideInlineCode(text, match.index)) continue;

        const date = parseTagDate(match[1], format, timestampOffset);

        if (date) matches.push({ date, end: match.index + match[0].length });
    }

    return matches;
};

/* TIMEKEEPING */

export const parseStartedDate = (startedTag: string, format: string): Date | undefined => {
    const match = startedTag && startedTag.match(/@started\(([^)]*)\)/);

    if (!match) return;

    return parseTagDate(match[1], format);
};

export const getToggleTag = (format: string, date: Date = new Date()): string =>
    `@toggle(${moment(date).format(format)})`;

export const getTimerState = (
    text: string,
    format: string,
    endDate: Date = new Date(),
    timestampOffset: number = 0
): TimerState | undefined => {
    const startedTag = findTagDates(text, 'started', format, timestampOffset)[0];

    if (!startedTag) return;

    const startedDate = startedTag.date,
        toggleDates: Date[] = [];

    findTagDates(text, 'toggle', format, timestampOffset, startedTag.end).forEach(
        ({ date: toggleDate }) => {
            const previousDate = toggleDates.length
                ? toggleDates[toggleDates.length - 1]
                : startedDate;

            if (
                toggleDate.getTime() < previousDate.getTime() ||
                toggleDate.getTime() > endDate.getTime()
            ) {
                return;
            }

            toggleDates.push(toggleDate);
        }
    );

    let active = true,
        intervalStart = startedDate.getTime(),
        elapsedMilliseconds = 0;

    toggleDates.forEach((toggleDate) => {
        const toggleTime = Math.min(toggleDate.getTime(), endDate.getTime());

        if (toggleTime < intervalStart) return;
        if (active) elapsedMilliseconds += toggleTime - intervalStart;

        intervalStart = toggleTime;
        active = !active;
    });

    if (active && endDate.getTime() > intervalStart) {
        elapsedMilliseconds += endDate.getTime() - intervalStart;
    }

    return {
        startedDate,
        toggleDates,
        active,
        elapsedMilliseconds,
    };
};

export const formatElapsedDuration = (
    to: Date,
    from: Date,
    format: string,
    hoursPerDay: number,
    manHoursPerDay: number,
    manDaysPerWeek: number
): string => Time.diff(to, from, format, hoursPerDay, manHoursPerDay, manDaysPerWeek);
