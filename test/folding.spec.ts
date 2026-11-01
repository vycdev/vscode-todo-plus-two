import { expect } from 'chai';
import { getFoldingRanges } from '../src/utils/folding';

const isProject = (line: string) => /^\s*[^☐✔✘]+:\s*$/.test(line);

describe('Todo folding ranges', () => {
  it('leaves trailing blank lines outside folded project blocks', () => {
    const lines = [
      'Project One:',
      '  ☐ task',
      '  details',
      '',
      '',
      'Project Two:',
      '  ☐ another task',
    ];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 0, end: 2 },
      { start: 5, end: 6 },
    ]);
  });

  it('keeps nested projects foldable without consuming their following separator', () => {
    const lines = [
      'Root:',
      '  ☐ first',
      '  Child:',
      '    ☐ nested',
      '',
      '  ☐ last',
      '',
      'Next:',
      '  ☐ next task',
    ];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 0, end: 5 },
      { start: 2, end: 3 },
      { start: 7, end: 8 },
    ]);
  });

  it('does not create a range for an empty project', () => {
    expect(getFoldingRanges(['Empty:', '', 'Next:'], isProject)).to.deep.equal([]);
  });

  it('compares tabs and spaces using the configured tab size', () => {
    const lines = ['Root:', '\tChild:', '\t  ☐ nested', '    Sibling:', '        ☐ task'];

    expect(getFoldingRanges(lines, isProject, 4)).to.deep.equal([
      { start: 0, end: 4 },
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });

  it('folds an explicit region through its closing marker without requiring indentation', () => {
    const lines = ['@region', '☐ task', 'a note', '@endregion', '', '☐ outside'];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 0, end: 3, kind: 'region' },
    ]);
  });

  it('pairs nested and adjacent regions in document order', () => {
    const lines = [
      '@region',
      '☐ first',
      '@region',
      '☐ nested',
      '@endregion',
      '@endregion',
      '@region',
      '☐ last',
      '@endregion',
    ];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 0, end: 5, kind: 'region' },
      { start: 2, end: 4, kind: 'region' },
      { start: 6, end: 8, kind: 'region' },
    ]);
  });

  it('accepts whitespace around markers independently of content indentation', () => {
    const lines = ['\t @region  ', '☐ task', ' \t@endregion\t'];

    expect(getFoldingRanges(lines, isProject, 2)).to.deep.equal([
      { start: 0, end: 2, kind: 'region' },
    ]);
  });

  it('ignores unmatched markers while keeping complete nested pairs', () => {
    const lines = ['@endregion', '@region', '@region', '☐ task', '@endregion'];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 2, end: 4, kind: 'region' },
    ]);
    expect(getFoldingRanges(['@endregion', '☐ task', '@region'], isProject)).to.deep.equal([]);
  });

  it('allows an empty region to hide its closing marker', () => {
    expect(getFoldingRanges(['@region', '@endregion'], isProject)).to.deep.equal([
      { start: 0, end: 1, kind: 'region' },
    ]);
  });

  it('does not treat inline tags, code examples, or longer tag names as markers', () => {
    const lines = [
      '☐ task @region',
      'note @region',
      '@region-name',
      '@region(label)',
      '@region extra',
      '`@region`',
      '@Region',
      '@endregion',
      '@region',
      '@endregion extra',
      '☐ task @endregion',
      '`@endregion`',
      '@endregion-name',
    ];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([]);
  });

  it('keeps project folds nested inside and around regions', () => {
    const lines = ['Root:', '  @region', '  Child:', '    ☐ task', '  @endregion', '  ☐ outside'];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 0, end: 5 },
      { start: 1, end: 4, kind: 'region' },
      { start: 2, end: 3 },
    ]);
  });

  it('prefers a region that crosses out of a project into the next one', () => {
    const lines = [
      'First:',
      '  ☐ first',
      '  @region',
      '  ☐ more',
      'Next:',
      '  ☐ next',
      '@endregion',
    ];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 2, end: 6, kind: 'region' },
      { start: 4, end: 5 },
    ]);
  });

  it('prefers a region when a project continues past its closing marker', () => {
    const lines = ['@region', 'Project:', '  ☐ task', '  @endregion', '  ☐ outside'];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 0, end: 3, kind: 'region' },
    ]);
  });

  it('does not return a project fold ending on a region opening marker', () => {
    const lines = ['Project:', '  ☐ task', '  @region', '☐ unindented', '@endregion'];

    expect(getFoldingRanges(lines, isProject)).to.deep.equal([
      { start: 2, end: 4, kind: 'region' },
    ]);
  });
});
