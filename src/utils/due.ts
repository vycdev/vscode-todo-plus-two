/* IMPORT */

import * as moment from 'moment';

/* DUE */

const DAY_MS = 24 * 60 * 60 * 1000;

const Due = {
    statuses: ['overdue', 'today', 'soon', 'later'],

    extract(tag: string) {
        const match = tag.match(/^@due\(([^)]*)\)$/i);

        return match && match[1].trim();
    },

    parse(value: string) {
        if (!value) return;

        const formats = [
            'YYYY-MM-DD HH:mm',
            'YYYY-MM-DD',
            'YYYY/MM/DD HH:mm',
            'YYYY/MM/DD',
            'YY-MM-DD HH:mm',
            'YY-MM-DD',
            'MM/DD/YYYY',
            'MM/DD/YY',
        ];

        const parsed = moment(value, formats, true);

        if (parsed.isValid()) return parsed.toDate();

        const formattedDateRe =
            /^(?:\d{4}[-/]\d{2}[-/]\d{2}|\d{2}-\d{2}-\d{2}|\d{2}\/\d{2}\/(?:\d{2}|\d{4}))(?: \d{2}:\d{2})?$/;

        if (formattedDateRe.test(value)) return;

        const sugar = require('sugar-date'); // Lazy import for natural dates
        const date = sugar.Date.create(value);

        return date && !isNaN(date.getTime()) ? date : undefined;
    },

    startOfDay(date: Date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    },

    status(value: string, today: Date = new Date(), soonDays: number = 7) {
        const date = Due.parse(value);

        if (!date) return;

        const dueDay = Due.startOfDay(date).getTime(),
            todayDay = Due.startOfDay(today).getTime(),
            days = Math.round((dueDay - todayDay) / DAY_MS),
            normalizedSoonDays = Math.max(0, Number(soonDays) || 0);

        if (days < 0) return 'overdue';
        if (days === 0) return 'today';
        if (days <= normalizedSoonDays) return 'soon';

        return 'later';
    },

    statusFromTag(tag: string, today: Date = new Date(), soonDays: number = 7) {
        return Due.status(Due.extract(tag), today, soonDays);
    },
};

/* EXPORT */

export default Due;
