//TODO: Publish as `time-diff` or something

/* IMPORT */

import * as _ from 'lodash';
import * as moment from 'moment';
import 'moment-precise-range-plugin';
import * as toTime from 'to-time';

/* TIME */

const Time = {
    diff(
        to: Date | string | number,
        from: Date = new Date(),
        format: string = 'long',
        hoursPerDay: number = 24,
        manHoursPerDay: number = 8,
        manDaysPerWeek: number = 5
    ) {
        const toSeconds = Time.diffSeconds(to, from),
            toDate = new Date(from.getTime() + toSeconds * 1000);

        switch (format) {
            case 'long':
                return Time.diffLong(toDate, from);
            case 'short':
                return Time.diffShort(toDate, from, hoursPerDay);
            case 'short-compact':
                return Time.diffShortCompact(toDate, from, hoursPerDay);
            case 'clock':
                return Time.diffClock(toDate, from);
            case 'seconds':
                return Time.diffSeconds(toDate, from);
            case 'hours':
                return Time.diffHours(toDate, from);
            case 'man-hours':
                return Time.diffManHours(toDate, from);
            case 'man-days':
                return Time.diffMan(toDate, from, manHoursPerDay, manDaysPerWeek, false);
            case 'man-weeks':
                return Time.diffMan(toDate, from, manHoursPerDay, manDaysPerWeek, true);
        }
    },

    diffLong(to: Date, from: Date = new Date()) {
        return moment['preciseDiff'](from, to);
    },

    diffShortRaw(to: Date, from: Date = new Date(), hoursPerDay: number = 24) {
        const seconds = Math.round((to.getTime() - from.getTime()) / 1000),
            secondsAbs = Math.abs(seconds),
            sign = Math.sign(seconds),
            normalizedHoursPerDay = Math.max(1, Number(hoursPerDay) || 24);

        let remaining = secondsAbs,
            parts = [];

        const sections: [string, number][] = [
            ['y', 31536000],
            ['w', 604800],
            ['d', normalizedHoursPerDay * 3600],
            ['h', 3600],
            ['m', 60],
            ['s', 1],
        ];

        sections.forEach(([token, seconds]) => {
            const times = Math.floor(remaining / seconds);

            parts.push({ times, token });

            remaining -= seconds * times;
        });

        return { parts, sign };
    },

    diffShort(to: Date, from?: Date, hoursPerDay: number = 24) {
        const { parts, sign } = Time.diffShortRaw(to, from, hoursPerDay);

        const shortParts = [];

        parts.forEach(({ times, token }) => {
            if (!times) return;

            shortParts.push(`${times}${token}`);
        });

        return shortParts.length ? `${sign < 0 ? '-' : ''}${shortParts.join(' ')}` : '0s';
    },

    diffShortCompact(to: Date, from?: Date, hoursPerDay: number = 24) {
        return Time.diffShort(to, from, hoursPerDay).replace(/\s+/g, '');
    },

    diffManRaw(
        to: Date,
        from: Date = new Date(),
        manHoursPerDay: number = 8,
        manDaysPerWeek: number = 5,
        includeWeeks: boolean = true
    ) {
        const seconds = Math.round((to.getTime() - from.getTime()) / 1000),
            secondsAbs = Math.abs(seconds),
            sign = Math.sign(seconds),
            normalizedHoursPerDay = Math.max(1, Number(manHoursPerDay) || 8),
            normalizedDaysPerWeek = Math.max(1, Number(manDaysPerWeek) || 5);

        let remaining = secondsAbs,
            parts = [];

        const sections: [string, number][] = includeWeeks
            ? [
                  ['mw', normalizedHoursPerDay * normalizedDaysPerWeek * 3600],
                  ['md', normalizedHoursPerDay * 3600],
                  ['h', 3600],
                  ['m', 60],
                  ['s', 1],
              ]
            : [
                  ['md', normalizedHoursPerDay * 3600],
                  ['h', 3600],
                  ['m', 60],
                  ['s', 1],
              ];

        sections.forEach(([token, seconds]) => {
            const times = Math.floor(remaining / seconds);

            parts.push({ times, token });

            remaining -= seconds * times;
        });

        return { parts, sign };
    },

    diffMan(
        to: Date,
        from?: Date,
        manHoursPerDay: number = 8,
        manDaysPerWeek: number = 5,
        includeWeeks: boolean = true
    ) {
        const { parts, sign } = Time.diffManRaw(
            to,
            from,
            manHoursPerDay,
            manDaysPerWeek,
            includeWeeks
        );

        const manParts = [];

        parts.forEach(({ times, token }) => {
            if (!times) return;

            manParts.push(`${times}${token}`);
        });

        return `${sign < 0 ? '-' : ''}${manParts.join(' ')}`;
    },

    diffManHours(to: Date, from?: Date) {
        const seconds = Math.round((to.getTime() - (from || new Date()).getTime()) / 1000),
            secondsAbs = Math.abs(seconds),
            sign = Math.sign(seconds),
            manParts = [];

        let remaining = secondsAbs;

        const sections: [string, number][] = [
            ['h', 3600],
            ['m', 60],
            ['s', 1],
        ];

        sections.forEach(([token, seconds]) => {
            const times = Math.floor(remaining / seconds);

            if (times) manParts.push(`${times}${token}`);

            remaining -= seconds * times;
        });

        return `${sign < 0 ? '-' : ''}${manParts.join('')}`;
    },

    diffClock(to: Date, from?: Date) {
        const { parts, sign } = Time.diffShortRaw(to, from);

        const padTokens = ['h', 'm', 's'],
            clockParts = [];

        parts.forEach(({ times, token }) => {
            if (!times && !clockParts.length) return;

            clockParts.push(
                `${padTokens.indexOf(token) >= 0 && clockParts.length ? _.padStart(times, 2, '0') : times}`
            );
        });

        return `${sign < 0 ? '-' : ''}${clockParts.join(':')}`;
    },

    diffSeconds(to?: Date | string | number, from: Date = new Date()) {
        if (to === undefined || to === null) return 0;

        let toDate;

        if (to instanceof Date) {
            toDate = to;
        } else if (_.isNumber(to)) {
            toDate = new Date(to);
        } else {
            to = to.replace(/ and /gi, ' ');
            // Normalize compact durations like "1h5m21s" into a tokenized form that `to-time` can parse reliably.
            // Insert a space after any time unit (ms|s|m|h|d|w|y) when followed immediately by a digit.
            // This handles cases such as "1h5m21s" -> "1h 5m 21s" and also "90m30s" -> "90m 30s".
            to = to.replace(/(ms|[smhdwy])(?=\d)/gi, '$1 ');
            // Collapse any duplicate spacing introduced by normalization
            to = to.replace(/\s+/g, ' ').trim();

            if (/^\s*\d+\s*$/.test(to)) return 0;

            const sugar = require('sugar-date'); //TSC // Lazy import for performance

            if (!toDate) {
                // sugar + ` from now` //FIXME: Should be + ` from ${date.toString ()}` or something
                const date = sugar.Date.create(`${to} from now`);
                if (!_.isNaN(date.getTime())) {
                    toDate = date;
                }
            }

            if (!toDate) {
                // sugar
                const date = sugar.Date.create(to);
                if (!_.isNaN(date.getTime())) {
                    toDate = date;
                }
            }

            if (!toDate) {
                // to-time
                try {
                    const milliseconds = toTime(to).milliseconds();
                    toDate = new Date(from.getTime() + milliseconds);
                } catch (e) {}
            }
        }

        return toDate ? Math.round((toDate.getTime() - from.getTime()) / 1000) : 0;
    },

    diffHours(to: Date, from: Date = new Date()) {
        const hours = moment(to).diff(moment(from), 'hours');

        return `${hours}h`;
    },
};

/* EXPORT */

export default Time;
