import { expect } from 'chai';
import { getActivePlannedTags, parsePlanned } from '../src/utils/planned';

describe('Planned work windows', () => {
  const at = (hour: number, minute = 0, day = 2) => new Date(2026, 10, day, hour, minute);
  const active = (value: string, now: Date) =>
    getActivePlannedTags(`☐ Work @planned(${value})`, now).length > 0;

  it('parses daily sessions in 12-hour and 24-hour notation', () => {
    expect(parsePlanned('10am-1pm, 16:30 - 17:45')).to.deep.equal([
      { date: undefined, start: 600, end: 780 },
      { date: undefined, start: 990, end: 1065 },
    ]);
    expect(active('10:30 AM - 1:15 pm', at(10, 30))).to.equal(true);
  });

  it('includes starts, excludes ends, and leaves gaps inactive', () => {
    const value = '1pm-3pm, 4pm-5pm';
    for (const [hour, minute, expected] of [
      [12, 59, false],
      [13, 0, true],
      [14, 59, true],
      [15, 0, false],
      [15, 59, false],
      [16, 0, true],
      [17, 0, false],
    ] as [number, number, boolean][]) {
      expect(active(value, at(hour, minute))).to.equal(expected, `${hour}:${minute}`);
    }
    expect(active(value, new Date(2026, 10, 2, 14, 59, 59, 999))).to.equal(true);
  });

  it('distinguishes midnight from noon and repeats undated windows daily', () => {
    expect(active('12am-12:30am', at(0))).to.equal(true);
    expect(active('12am-12:30am', at(12))).to.equal(false);
    expect(active('12pm-1pm', at(12))).to.equal(true);
    expect(active('10am-1pm', at(11, 0, 3))).to.equal(true);
  });

  it('applies a local calendar date to all sessions in a tag', () => {
    const value = '2026-11-02 10am-1pm, 4pm-5pm';
    expect(active(value, at(11))).to.equal(true);
    expect(active(value, at(16))).to.equal(true);
    expect(active(value, at(11, 0, 3))).to.equal(false);
    expect(active(value, at(11, 0, 1))).to.equal(false);
    expect(parsePlanned(value).map((window) => window.date)).to.deep.equal([
      '2026-11-02',
      '2026-11-02',
    ]);
  });

  it('accepts leap days and rejects impossible calendar dates', () => {
    expect(parsePlanned('2028-02-29 10am-1pm')).to.have.length(1);
    for (const date of ['2026-02-29', '2026-02-30', '2026-00-02', '2026-13-02', '2026-11-00']) {
      expect(parsePlanned(`${date} 10am-1pm`)).to.deep.equal([], date);
    }
  });

  it('rejects invalid or ambiguous times and unsupported scheduling syntax', () => {
    for (const value of [
      '',
      '10am',
      '10-13',
      '0am-1am',
      '13pm-2pm',
      '10:60-11:00',
      '24:00-25:00',
      '10am-10am',
      '10pm-1am',
      '10am-1pm,',
      '10am-1pm, invalid',
      '10am-1pm\n4pm-5pm',
      '2026-11-02',
      '2026-11-2 10am-1pm',
      'tomorrow 10am-1pm',
      'Mon-Fri 10am-1pm',
      '10am-1pm 4pm-5pm',
    ]) {
      expect(parsePlanned(value)).to.deep.equal([], value);
    }
  });

  it('returns exact tag offsets for multiple independent tags', () => {
    const text = '☐ Work @planned(invalid) @PLANNED(10am-1pm) @planned(2026-11-03 4pm-5pm)';
    const ranges = getActivePlannedTags(text, at(11));
    expect(ranges.map(({ start, end }) => text.slice(start, end))).to.deep.equal([
      '@PLANNED(10am-1pm)',
    ]);
    const adjacent = '@planned(10am-1pm)@planned(10am-1pm)';
    expect(getActivePlannedTags(adjacent, at(11))).to.have.length(2);
  });

  it('ignores attached words, bare labels, and inline-code examples', () => {
    for (const text of [
      '☐ Work word@planned(10am-1pm)',
      '☐ Work @planned',
      '☐ Work `@planned(10am-1pm)`',
      '☐ Work ``example `literal` @planned(10am-1pm)``',
      '☐ Work `@planned(10am-1pm)',
    ]) {
      expect(getActivePlannedTags(text, at(11))).to.deep.equal([], text);
    }
    expect(getActivePlannedTags('☐ Work `example` @planned(10am-1pm)', at(11))).to.have.length(1);
    expect(getActivePlannedTags('☐ Work `unfinished @planned(10am-1pm)', at(11))).to.have.length(1);
  });

  it('does not turn inline code inside an argument into a valid work window', () => {
    for (const value of [
      '10am-`ignored`1pm',
      '`ignored`10am-1pm',
      '2026-11-02 `ignored`10am-1pm',
      '10am-1pm`ignored`',
      '10am-`ignored)`1pm',
    ]) {
      expect(parsePlanned(value)).to.deep.equal([], value);
      expect(getActivePlannedTags(`☐ Work @planned(${value})`, at(11))).to.deep.equal([], value);
    }
  });
});
