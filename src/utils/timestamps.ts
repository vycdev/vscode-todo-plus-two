/* IMPORT */

import * as moment from 'moment';

/* TIMESTAMPS */

const Timestamps = {
    aliases: ['@created', '@now'],

    getPrefix(line: string, character: number) {
        const beforeCursor = line.substring(0, character),
            match = beforeCursor.match(/(?:^|[^a-zA-Z0-9`])(@[^\s*~(]*)$/);

        if (!match) return;

        const text = match[1],
            start = character - text.length;

        return { text, start, end: character };
    },

    format(date: Date = new Date(), format: string = 'YY-MM-DD HH:mm') {
        return moment(date).format(format);
    },

    expand(alias: string, format: string, date: Date = new Date()) {
        const timestamp = Timestamps.format(date, format);

        if (alias === '@now') return timestamp;

        return `@created(${timestamp})`;
    },
};

/* EXPORT */

export default Timestamps;
