/* IMPORT */

import * as moment from 'moment';

/* TIMEKEEPING */

export const parseStartedDate = (startedTag: string, format: string): Date | undefined => {
    const match = startedTag && startedTag.match(/@started\(([^)]*)\)/);

    if (!match || !match[1]) return;

    const startedMoment = moment(match[1], format, true);

    if (!startedMoment.isValid()) return;

    return new Date(startedMoment.valueOf());
};
