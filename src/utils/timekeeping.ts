/* IMPORT */

import * as moment from 'moment';
import Time from './time';

/* TIMEKEEPING */

export const parseStartedDate = (startedTag: string, format: string): Date | undefined => {
    const match = startedTag && startedTag.match(/@started\(([^)]*)\)/);

    if (!match || !match[1]) return;

    const startedMoment = moment(match[1], format, true);

    if (!startedMoment.isValid()) return;

    return new Date(startedMoment.valueOf());
};

export const formatElapsedDuration = (
    to: Date,
    from: Date,
    format: string,
    hoursPerDay: number,
    manHoursPerDay: number,
    manDaysPerWeek: number
): string => Time.diff(to, from, format, hoursPerDay, manHoursPerDay, manDaysPerWeek);
