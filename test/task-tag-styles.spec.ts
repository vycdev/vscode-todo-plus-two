import { expect } from 'chai';
import {
  getTaskTagStyleRanges,
  getTaskTagStyleRules,
  resolveTaskTagStyle,
} from '../src/utils/task-tag-styles';

describe('Task tag styling rules', () => {
  it('combines properties and lets the last tag win ties', () => {
    const rules = {
      blocked: { color: 'red', bold: true },
      review: { color: 'yellow', italic: true },
    };

    expect(resolveTaskTagStyle('☐ Task @blocked @review', rules).base).to.deep.equal({
      color: 'yellow',
      bold: true,
      italic: true,
    });
    expect(resolveTaskTagStyle('☐ Task @review @blocked', rules).base.color).to.equal('red');
    expect(resolveTaskTagStyle('☐ Task @blocked @review @blocked', rules).base.color).to.equal(
      'red'
    );
  });

  it('resolves priority per property and honors explicit false values', () => {
    const style = resolveTaskTagStyle('☐ Task @important @plain', {
      important: { color: 'red', priority: 5, bold: false },
      plain: { color: 'blue', bold: true, italic: true },
    }).base;

    expect(style).to.deep.equal({ color: 'red', bold: false, italic: true });
  });

  it('inherits legacy colors, theme variants and the done strikethrough preference', () => {
    const rules = getTaskTagStyleRules({
      colors: { done: 'green', dark: { done: 'dark-green' } },
      decorations: { done: { strikethrough: false } },
    });
    const style = resolveTaskTagStyle('✔ Task @done @started', rules);

    expect(style.base).to.deep.equal({ color: 'green', strikethrough: false });
    expect(style.dark.color).to.equal('dark-green');
    expect(style.light.color).to.equal('green');
  });

  it('preserves the default finished appearance ahead of started and paused tags', () => {
    const rules = getTaskTagStyleRules({});
    expect(resolveTaskTagStyle('✔ Task @done @started @paused', rules).base).to.deep.equal({
      color: '#a6e22e',
      strikethrough: true,
    });
    expect(resolveTaskTagStyle('✘ Task @cancelled @started', rules).base.color).to.equal('#f92672');
    expect(resolveTaskTagStyle('☐ Task @started @paused', rules).base.color).to.equal('#e5d145');
  });

  it('allows explicit rule properties to override legacy defaults in every theme', () => {
    const rules = getTaskTagStyleRules({
      colors: { done: 'old', dark: { done: 'old-dark' } },
      tags: {
        styles: { done: { color: 'new', strikethrough: false, light: { color: 'new-light' } } },
      },
    });
    const style = resolveTaskTagStyle('✔ Task @done', rules);

    expect(style.base).to.deep.equal({ color: 'new', strikethrough: false });
    expect(style.dark.color).to.equal('new');
    expect(style.light.color).to.equal('new-light');
  });

  it('honors an empty legacy color rather than restoring a hard-coded color', () => {
    const rules = getTaskTagStyleRules({ colors: { done: '' } });
    expect(resolveTaskTagStyle('✔ Task @done', rules).base.color).to.equal('');
  });

  it('resolves theme-specific conflicts with the same priority and order rules', () => {
    const style = resolveTaskTagStyle('☐ Task @first @last', {
      first: { color: 'red', dark: { color: 'dark-red', bold: true } },
      last: { color: 'blue', light: { color: 'light-blue' } },
    });
    expect(style.dark).to.deep.equal({ color: 'blue', bold: true });
    expect(style.light.color).to.equal('light-blue');
  });

  it('can disable built-in rules and customize tags outside the special-tag list', () => {
    const rules = getTaskTagStyleRules({
      tags: { styles: { done: false, custom: { bold: true } } },
    });
    expect(resolveTaskTagStyle('✔ Task @done @custom', rules).base).to.deep.equal({ bold: true });
    expect(resolveTaskTagStyle('✔ Task', rules).base).to.deep.equal({});
  });

  it('matches complete, case-sensitive tag names, punctuation and arguments', () => {
    const rules = { blocked: { bold: true }, 'on-hold': { italic: true } };
    expect(
      resolveTaskTagStyle('☐ Task @blockedSoon @blocked-other @Blocked', rules).base
    ).to.deep.equal({});
    expect(resolveTaskTagStyle('☐ Task @blocked(reason), @on-hold.', rules).base).to.deep.equal({
      bold: true,
      italic: true,
    });
    expect(resolveTaskTagStyle('☐ Task word@blocked @other(@blocked)', rules).base).to.deep.equal(
      {}
    );
  });

  it('ignores tags in matching inline-code spans', () => {
    const rules = { done: { strikethrough: true } };
    expect(
      resolveTaskTagStyle('☐ Explain `@done` and ``a `literal` @done``', rules).base
    ).to.deep.equal({});
    expect(resolveTaskTagStyle('☐ Explain `@done` @done', rules).base.strikethrough).to.equal(true);
  });

  it('treats backticks inside tag arguments literally before scanning real inline code', () => {
    const text = '☐ Task @note(`literal) @blocked `code`';
    const rules = { blocked: { color: 'red' } };
    expect(resolveTaskTagStyle(text, rules).base.color).to.equal('red');
    const pieces = getTaskTagStyleRanges(text).map(({ start, end }) => text.slice(start, end));
    expect(pieces).to.deep.equal(['☐ Task ', ' ', ' ']);
    expect(resolveTaskTagStyle('☐ Explain `@note(value) @blocked`', rules).base).to.deep.equal({});
  });

  it('protects Markdown escapes, comments, code, and tag arguments', () => {
    const rules = { blocked: { color: 'red' } };
    const literal = '- [ ] Task \\@blocked <!-- @blocked --> `@blocked` @note(@blocked)';
    expect(resolveTaskTagStyle(literal, rules, true).base).to.deep.equal({});
    expect(resolveTaskTagStyle(`${literal} @blocked`, rules, true).base).to.deep.equal({
      color: 'red',
    });
    const pieces = getTaskTagStyleRanges(`${literal} @blocked`, true).map(({ start, end }) =>
      literal.slice(start, end)
    );
    expect(pieces.join('')).not.to.include('<!--');
    expect(pieces.join('')).not.to.include('`');
  });

  it('excludes tag labels, arguments and inline code from task-text styling', () => {
    const text = '☐ Task ``some `code` here`` @blocked(reason) next @custom end';
    const pieces = getTaskTagStyleRanges(text).map(({ start, end }) => text.slice(start, end));
    expect(pieces).to.deep.equal(['☐ Task ', ' ', ' next ', ' end']);
  });

  it('ignores malformed settings instead of passing arbitrary decoration options through', () => {
    const rules = getTaskTagStyleRules({
      tags: {
        styles: {
          broken: null,
          array: [],
          custom: {
            color: 123,
            bold: 'yes',
            italic: true,
            priority: Infinity,
            command: 'do-something',
          },
        },
      },
    });
    expect(resolveTaskTagStyle('☐ Task @broken @array @custom', rules).base).to.deep.equal({
      italic: true,
    });
  });
});
