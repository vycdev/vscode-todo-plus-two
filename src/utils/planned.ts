import { maskInlineCode } from './todo-status';

export interface PlannedWindow {
  date?: string;
  start: number;
  end: number;
}

const parseTime = (value: string): number | undefined => {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?[ \t]*(am|pm)?$/i);

  if (!match) return;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3] && match[3].toLowerCase();

  if (minute > 59) return;

  if (period) {
    if (hour < 1 || hour > 12) return;
    hour = (hour % 12) + (period === 'pm' ? 12 : 0);
  } else if (!match[2] || hour > 23) {
    return;
  }

  return hour * 60 + minute;
};

export const parsePlanned = (value: string): PlannedWindow[] => {
  if (/[\r\n]/.test(value)) return [];

  const text = value.trim();
  const dated = text.match(/^(\d{4}-\d{2}-\d{2})[ \t]+/);
  const date = dated && dated[1];

  if (date) {
    const [year, month, day] = date.split('-').map(Number);
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);

    if (
      calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day
    ) {
      return [];
    }
  }

  const ranges = (dated ? text.slice(dated[0].length) : text).split(',');
  const windows: PlannedWindow[] = [];

  for (const range of ranges) {
    const ends = range.split('-');
    if (ends.length !== 2) return [];

    const start = parseTime(ends[0]);
    const end = parseTime(ends[1]);

    if (start === undefined || end === undefined || start >= end) return [];

    windows.push({ date: date || undefined, start, end });
  }

  return windows;
};

export const getActivePlannedTags = (
  text: string,
  now: Date = new Date()
): { start: number; end: number }[] => {
  const maskedText = maskInlineCode(text);
  const pattern = /@planned\(([^\r\n)]*)\)/gi;
  const today = `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const minute = now.getHours() * 60 + now.getMinutes();
  const ranges: { start: number; end: number }[] = [];
  let match: RegExpExecArray;

  while ((match = pattern.exec(maskedText))) {
    if (match.index && /[a-zA-Z0-9`]/.test(maskedText[match.index - 1])) continue;

    // Mask code only to locate tags. Parse the original argument so an inline
    // code span cannot become valid whitespace inside a malformed window.
    const value = text.slice(match.index + '@planned('.length, match.index + match[0].length - 1);
    const active = parsePlanned(value).some(
      (window) =>
        (!window.date || window.date === today) && minute >= window.start && minute < window.end
    );

    if (active) ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges;
};
