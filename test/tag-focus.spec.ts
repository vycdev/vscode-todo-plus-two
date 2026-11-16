import { expect } from 'chai';
import { getFocusTagNames, getTagFocusRanges, isTagFocusHeader } from '../src/utils/tag-focus';

const isTodo = (line: string) => /^\s*(?:[☐✔✘]|- \[[ xX]\]) /.test(line);
const isProject = (line: string) => !isTodo(line) && /^\s*.+:\s*$/.test(line);
const tagPattern = /(?:^|[^a-zA-Z0-9`])(@[^\s*~(]+(?::\/\/[^\s*~(:]+)?(?:\([^)]*\))?)/gm;
const getRanges = (lines: string[], tag = '@critical', tabSize = 4) =>
  getTagFocusRanges(lines, tag, isTodo, isProject, tagPattern, tabSize);
const getVisible = (lines: string[], tag = '@critical') => {
  const ranges = getRanges(lines, tag);
  return lines.filter((_, line) => !ranges.some(({ start, end }) => start < line && line <= end));
};

describe('Tag focus ranges', () => {
  it('keeps only the persistent header, matching tasks, and their ancestor context', () => {
    const lines = [
      '(folded)',
      '☐ unrelated first task',
      'Project:',
      '  ☐ unrelated task',
      '  Subproject:',
      '    ☐ parent',
      '      ☐ matching @critical',
      '      notes about the task',
      '    ☐ unrelated sibling',
      'Other:',
      '  ☐ unrelated last task',
    ];

    expect(getVisible(lines)).to.deep.equal([
      '(folded)',
      'Project:',
      '  Subproject:',
      '    ☐ parent',
      '      ☐ matching @critical',
    ]);
  });

  it('hides isolated nonmatching lines between matching tasks', () => {
    const lines = ['(folded)', '☐ one @critical', '☐ hidden', '☐ two @critical', '☐ hidden last'];

    expect(getRanges(lines)).to.deep.equal([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });

  it('matches whole tag names case-insensitively, including tags with arguments and punctuation', () => {
    const lines = [
      '(folded)',
      '☐ one @criticality',
      '☐ two @CRITICAL',
      '☐ three @critical(reason)',
      '☐ four @critical,',
      '☐ five @critical-other',
      '☐ six @critical.extra',
    ];

    expect(getVisible(lines)).to.deep.equal([lines[0], lines[2], lines[3], lines[4]]);
  });

  it('treats regex characters in tag names literally', () => {
    const lines = ['(folded)', '☐ one @c++', '☐ two @c', '☐ three @c++-extra'];

    expect(getVisible(lines, '@c++')).to.deep.equal([lines[0], lines[1]]);
  });

  it('ignores inline code, tag arguments, comments, and project tags as task matches', () => {
    const lines = [
      '(folded)',
      '☐ inline `@critical`',
      '☐ longer ``a `quoted` @critical``',
      '☐ argument @id(example @critical)',
      'note @critical',
      'Project: @critical',
      '  ☐ untagged child',
      '☐ real @critical',
    ];

    expect(getVisible(lines)).to.deep.equal([lines[0], lines[7]]);
  });

  it('keeps real tags after backticks in literal tag arguments', () => {
    const lines = ['(folded)', '☐ task @id(`example) @critical `trailer'];

    expect(getVisible(lines)).to.deep.equal(lines);
    expect(getFocusTagNames(lines, isTodo, tagPattern)).to.deep.equal(['@critical', '@id']);
  });

  it('does not inherit tags from parent tasks or retain their untagged children', () => {
    const lines = ['(folded)', '☐ parent @critical', '  ☐ untagged child'];

    expect(getVisible(lines)).to.deep.equal([lines[0], lines[1]]);
  });

  it('recognizes Unicode, Markdown, done, and cancelled task symbols', () => {
    const lines = [
      '(folded)',
      '✔ done @critical',
      '✘ cancelled @critical',
      '- [ ] open @critical',
      '- [x] done @critical',
    ];

    expect(getRanges(lines)).to.deep.equal([]);
  });

  it('preserves context across skipped indentation levels and mixed tabs and spaces', () => {
    const lines = [
      '(folded)',
      'Root:',
      '\tParent:',
      '        ☐ task @critical',
      '    Sibling:',
      '        ☐ hidden',
    ];

    expect(getRanges(lines, '@critical', 4)).to.deep.equal([{ start: 3, end: 5 }]);
  });

  it('hides manual region markers without hiding matches inside them', () => {
    const lines = ['@region', '☐ hidden', '☐ match @critical', '@endregion'];

    expect(getVisible(lines)).to.deep.equal([lines[0], lines[2]]);
  });

  it('folds everything under the header if edits remove the last matching tag', () => {
    expect(getRanges(['(folded)', 'Project:', '  ☐ task', ''])).to.deep.equal([
      { start: 0, end: 3 },
    ]);
    expect(getRanges(['(folded)'])).to.deep.equal([]);
  });
});

describe('Tag focus picker and header', () => {
  it('offers unique task tag names, ignoring arguments, case variants, and inline examples', () => {
    const lines = [
      'Project: @project',
      'note @note',
      '☐ one @critical @due(tomorrow)',
      '☐ two @CRITICAL @due(next week)',
      '☐ code `@example` @c++',
      '☐ argument @id(thing @example)',
    ];

    expect(getFocusTagNames(lines, isTodo, tagPattern)).to.deep.equal([
      '@c++',
      '@critical',
      '@due',
      '@id',
    ]);
  });

  it('reuses a dedicated header or existing opening region marker only', () => {
    expect(isTagFocusHeader('(folded)')).to.equal(true);
    expect(isTagFocusHeader('  @region  ')).to.equal(true);
    expect(isTagFocusHeader('☐ task')).to.equal(false);
    expect(isTagFocusHeader('☐ task @region')).to.equal(false);
  });
});
