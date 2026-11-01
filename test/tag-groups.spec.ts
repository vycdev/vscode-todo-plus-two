import { expect } from 'chai';
import { getTaskTagNames, groupTasksByTags, normalizeTagGroupNames } from '../src/utils/tag-groups';

describe('Task tag grouping', () => {
  it('normalizes selected tags without changing their case or order', () => {
    expect(normalizeTagGroupNames([' @low ', 'low', '', '@tag-a', 'Low'])).to.deep.equal([
      'low',
      'tag-a',
      'Low',
    ]);
    expect(normalizeTagGroupNames(undefined)).to.deep.equal([]);
  });

  it('recognizes complete names and ignores arguments, inline code, and email addresses', () => {
    expect(
      getTaskTagNames(
        '☐ Work @low @low(review) @lowish @tag-a @tag_a @Low @note(@high) `@example` user@example.com @last.'
      )
    ).to.deep.equal(['low', 'lowish', 'tag-a', 'tag_a', 'Low', 'note', 'last']);
    expect(getTaskTagNames('☐ Explain ``code ` @low`` and `@high`')).to.deep.equal([]);
    expect(getTaskTagNames('☐ Unmatched ` @low')).to.deep.equal(['low']);
  });

  it('respects Markdown escapes, comments, code, and literal tag arguments', () => {
    expect(
      getTaskTagNames(
        '- [ ] Work \\@escaped <!-- @hidden --> `@code` @note(@nested) @low(value) @tag-a',
        true
      )
    ).to.deep.equal(['note', 'low', 'tag-a']);
  });

  it('finds adjacent tags after a closed argument without consuming their boundary', () => {
    for (const markdown of [false, true]) {
      expect(getTaskTagNames('Task @note(value)@low', markdown)).to.deep.equal(['note', 'low']);
    }
  });

  it('keeps backticks inside tag arguments from hiding following tags', () => {
    for (const markdown of [false, true]) {
      expect(getTaskTagNames('Task @id(`) @low @depends(`)', markdown)).to.deep.equal([
        'id',
        'low',
        'depends',
      ]);
    }
  });

  it('keeps Todo tag rules distinct from Markdown escapes and HTML comments', () => {
    const text = 'Task \\@low <!-- @high -->';
    expect(getTaskTagNames(text)).to.deep.equal(['low', 'high']);
    expect(getTaskTagNames(text, true)).to.deep.equal([]);
  });

  it('keeps source order and uses Other for tasks without a selected tag', () => {
    const tasks = [
      { text: 'First', tagNames: ['low', 'low', 'tag-a'] },
      { text: 'Second', tagNames: ['high'] },
      { text: 'Third', tagNames: ['low'] },
      { text: 'Unselected', tagNames: ['lowish'] },
      { text: 'Untagged', tagNames: [] },
    ];
    const groups = groupTasksByTags(tasks, ['tag-a', 'low', 'unused', 'high', '@low']);
    expect(groups.map((group) => group.name)).to.deep.equal(['tag-a', 'low', 'high', '']);
    expect(groups.map((group) => group.tasks.map((task) => task.text))).to.deep.equal([
      ['First'],
      ['First', 'Third'],
      ['Second'],
      ['Unselected', 'Untagged'],
    ]);
    expect(groups[0].tasks[0]).to.equal(tasks[0]);
    expect(tasks[0].tagNames).to.deep.equal(['low', 'low', 'tag-a']);
    expect(groupTasksByTags([], ['low'])).to.deep.equal([]);
  });

  it('keeps case-sensitive and prototype-like names separate', () => {
    const tasks = [
      { tagNames: ['low'] },
      { tagNames: ['Low'] },
      { tagNames: ['__proto__', 'constructor'] },
    ];
    expect(
      groupTasksByTags(tasks, ['Low', 'constructor', '__proto__']).map((group) => group.tasks)
    ).to.deep.equal([[tasks[1]], [tasks[2]], [tasks[2]], [tasks[0]]]);
  });
});
