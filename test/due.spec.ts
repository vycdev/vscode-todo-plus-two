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
    ]) {
      const value = `2026-07-02T09:00:00${offset}`;
      expect(Due.parse(value)).to.equal(undefined, value);
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
});
