import { expect } from 'chai';
import Due from '../src/utils/due';

describe('Due utilities', () => {
  const today = new Date(2026, 6, 2);

  it('extracts date text from @due tags', () => {
    expect(Due.extract('@due(2026-07-02)')).to.equal('2026-07-02');
  });

  it('classifies overdue, today, soon, and later due dates', () => {
    expect(Due.status('2026-07-01', today, 7)).to.equal('overdue');
    expect(Due.status('2026-07-02', today, 7)).to.equal('today');
    expect(Due.status('2026-07-08', today, 7)).to.equal('soon');
    expect(Due.status('2026-07-20', today, 7)).to.equal('later');
  });

  it('supports the existing short timestamp format', () => {
    expect(Due.status('26-07-02 10:30', today, 7)).to.equal('today');
  });

  it('rejects impossible formatted calendar dates, including loosely padded ISO dates', () => {
    for (const value of [
      '2026-02-30',
      '2026-2-30',
      '2026/2/30',
      '2026-02-30 9:00',
      '2026-02-30T09:00',
    ]) {
      expect(Due.status(value, today)).to.equal(undefined, value);
    }
  });

  it('rejects impossible formatted dates with seconds instead of rolling them forward', () => {
    for (const value of [
      '2026-02-30T09:00:00',
      '2026-02-30 09:00:00',
      '2026/02/30 09:00:00',
      '2026-2-30 9:00:00',
      '2026/2/30 9:00:00',
      '2026-02-29T09:00:00',
      '2026-02-30T09:00:00Z',
      '2026-02-30T09:00:00+02:00',
    ]) {
      expect(Due.status(value, today)).to.equal(undefined, value);
    }
  });

  it('rejects impossible zoned dates without seconds instead of rolling them forward', () => {
    for (const value of [
      '2026-02-30T09:00Z',
      '2026-02-30 09:00Z',
      '2026-02-30T09:00+02:00',
      '2026-02-30T09:00+0200',
      '2026/02/30 09:00-03:30',
    ]) {
      expect(Due.parse(value)).to.equal(undefined, value);
    }
  });

  it('rejects impossible calendar dates with lowercase z or hour-only offsets', () => {
    for (const date of [
      '2026-02-30T09:00',
      '2026-02-29T09:00',
      '2026-04-31 09:00',
      '2026-13-02T09:00',
      '2026-00-02T09:00',
      '2026-07-00T09:00',
      '2026-2-30T9:00',
      '2026/2/30 9:00',
    ]) {
      for (const seconds of ['', ':13']) {
        for (const zone of ['z', '+02', '-03']) {
          const value = `${date}${seconds}${zone}`;
          expect(Due.parse(value)).to.equal(undefined, value);
        }
      }
    }
  });

  it('rejects invalid clock ranges with lowercase z or hour-only offsets', () => {
    for (const time of [
      '25:00',
      '24:01',
      '09:60',
      '25:00:00',
      '24:00:01',
      '09:60:00',
      '09:00:60',
    ]) {
      for (const zone of ['z', '+02', '-03']) {
        const value = `2026-07-02T${time}${zone}`;
        expect(Due.parse(value)).to.equal(undefined, value);
      }
    }
  });

  it('rejects timezone offsets with invalid hours or minutes', () => {
    for (const offset of [
      '+24:00',
      '+25:00',
      '-24:00',
      '+02:60',
      '-02:60',
      '+99:99',
      '+2460',
      '-0260',
      '+24',
      '-24',
      '+99',
      '-99',
    ]) {
      for (const seconds of ['', ':13']) {
        const value = `2026-07-02T09:00${seconds}${offset}`;
        expect(Due.parse(value)).to.equal(undefined, value);
      }
    }
  });

  it('validates timestamps with fractional seconds like other timestamps', () => {
    for (const value of [
      '2021-02-29T09:00:00.000Z',
      '2021-02-30 09:00:00.5',
      '2021-04-31T09:00:00.123+02:00',
      '2021-02-28T25:00:00.000Z',
      '2021-02-28T09:00:00.000+24:00',
    ]) {
      expect(Due.parse(value)).to.equal(undefined, value);
    }
    for (const [value, expected] of [
      ['2021-02-28T09:00:00.000Z', '2021-02-28T09:00:00.000Z'],
      ['2021-02-28T09:00:00.5Z', '2021-02-28T09:00:00.500Z'],
      ['2021-02-28T09:00:00.123456z', '2021-02-28T09:00:00.123Z'],
      ['2021-02-28T09:00:00.123+0200', '2021-02-28T07:00:00.123Z'],
      ['2024/2/29 9:00:00.250-03', '2024-02-29T12:00:00.250Z'],
    ]) {
      expect(Due.parse(value)?.toISOString()).to.equal(expected, value);
    }
  });

  it('still accepts unzoned dates near the end of a month', () => {
    for (const day of [24, 29, 30, 31]) {
      expect(Due.parse(`2026-07-${day}`)?.getDate()).to.equal(day);
    }
  });

  it('still accepts valid loosely padded dates and timestamps with seconds', () => {
    expect(Due.status('2026-7-2', today)).to.equal('today');
    expect(Due.status('2026-07-02 9:00', today)).to.equal('today');
    expect(Due.status('2026-07-02T09:00', today)).to.equal('today');
    expect(Due.status('2026-07-02T09:00:00', today)).to.equal('today');
    expect(Due.status('2026-07-02 09:00:00', today)).to.equal('today');
    expect(Due.status('2026/07/02 09:00:00', today)).to.equal('today');
    expect(Due.status('2026-07-02 9:00:00', today)).to.equal('today');
    expect(Due.status('2026-7-2 9:00:00', today)).to.equal('today');
    expect(Due.status('2026-7-2T9:00:00', today)).to.equal('today');
    expect(Due.status('2026/7/2 9:00:00', today)).to.equal('today');
  });

  it('parses zoned timestamps as exact instants regardless of the local timezone', () => {
    for (const [value, expected] of [
      ['2026-07-02T09:00:00Z', '2026-07-02T09:00:00.000Z'],
      ['2026-07-02T09:00:00+02:00', '2026-07-02T07:00:00.000Z'],
      ['2026-07-02T09:00:00-10:00', '2026-07-02T19:00:00.000Z'],
      ['2026-07-02T09:00:00+0200', '2026-07-02T07:00:00.000Z'],
      ['2026-7-2 9:00:00+02:30', '2026-07-02T06:30:00.000Z'],
      ['2026/7/2 9:00:00-03:30', '2026-07-02T12:30:00.000Z'],
      ['2026-07-02T09:00Z', '2026-07-02T09:00:00.000Z'],
      ['2026-07-02T09:00+02:00', '2026-07-02T07:00:00.000Z'],
      ['2026-07-02T09:00+0200', '2026-07-02T07:00:00.000Z'],
    ]) {
      expect(Due.parse(value)?.toISOString()).to.equal(expected, value);
    }
  });

  it('preserves exact instants with lowercase z or hour-only offsets', () => {
    for (const seconds of ['', ':13']) {
      for (const [zone, utcTime] of [
        ['z', '09:00'],
        ['+02', '07:00'],
        ['-03', '12:00'],
      ]) {
        for (const date of [
          '2026-07-02T09:00',
          '2026-7-2T9:00',
          '2026-7-2 9:00',
          '2026/7/2 9:00',
          '2024-2-29T9:00',
        ]) {
          const value = `${date}${seconds}${zone}`;
          const utcDate = date.startsWith('2024') ? '2024-02-29' : '2026-07-02';
          const utcSeconds = seconds || ':00';
          expect(Due.parse(value)?.toISOString()).to.equal(
            `${utcDate}T${utcTime}${utcSeconds}.000Z`,
            value
          );
        }
      }
    }
  });

  it('retains natural-language due dates', () => {
    const now = new Date();
    const tomorrow = Due.parse('tomorrow');
    const after = new Date();
    const possibleDays = [now, after].map((date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
    );

    expect(tomorrow).to.be.instanceOf(Date);
    expect(possibleDays).to.include(Due.startOfDay(tomorrow).getTime());
  });
});
