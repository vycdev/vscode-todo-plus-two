import { getMarkdownTaskTags, getTodoTaskTags } from './markdown-task-text';

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
  now: Date = new Date(),
  markdown: boolean = false
): { start: number; end: number }[] => {
  const tags = markdown ? getMarkdownTaskTags(text) : getTodoTaskTags(text);
  const today = `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const minute = now.getHours() * 60 + now.getMinutes();
  const ranges: { start: number; end: number }[] = [];
  for (const tag of tags) {
    const match = /^@planned\(([^\r\n)]*)\)$/i.exec(tag.text);
    if (!match) continue;
    const active = parsePlanned(match[1]).some(
      (window) =>
        (!window.date || window.date === today) && minute >= window.start && minute < window.end
    );

    if (active) ranges.push({ start: tag.start, end: tag.end });
  }

  return ranges;
};
