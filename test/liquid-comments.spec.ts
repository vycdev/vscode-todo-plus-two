import { expect } from 'chai';
import { splitLines } from '../src/utils/line-splitting';
import {
  isLiquidFilePath,
  parseLiquidBlockCommentMatches,
} from '../src/utils/embedded/liquid-comments';

const properties = require('../package.json').contributes.configuration.properties;
const embeddedRegex = new RegExp(
  properties['todo.embedded.regex'].default,
  properties['todo.embedded.regexFlags'].default
);

const parse = (content: string) =>
  parseLiquidBlockCommentMatches(splitLines(content), embeddedRegex);

describe('Liquid block comments', () => {
  it('finds bare markers inside multiline comment tags', () => {
    const matches = parse(
      [
        "{% assign note = 'TODO: not a comment' %}",
        '{% comment %}',
        '    TODO: update the product copy',
        '    FIXME: remove the fallback',
        '{% endcomment %}',
        'TODO: outside the comment',
      ].join('\n')
    );

    expect(
      matches.map(({ type, message, lineNr, column, todo }) => ({
        type,
        message,
        lineNr,
        column,
        todo,
      }))
    ).to.deep.equal([
      {
        type: 'TODO',
        message: ' update the product copy',
        lineNr: 2,
        column: 4,
        todo: 'TODO: update the product copy',
      },
      {
        type: 'FIXME',
        message: ' remove the fallback',
        lineNr: 3,
        column: 4,
        todo: 'FIXME: remove the fallback',
      },
    ]);
  });

  it('finds bare markers inside comment blocks in a liquid tag', () => {
    const matches = parse(
      [
        '{% liquid',
        '  assign visible = "TODO: not a comment"',
        '  comment',
        '    TODO: update the product copy',
        '  endcomment',
        '  assign visible = "FIXME: not a comment"',
        '%}',
      ].join('\n')
    );

    expect(matches).to.have.length(1);
    expect(matches[0]).to.include({
      type: 'TODO',
      message: ' update the product copy',
      lineNr: 3,
      column: 4,
      todo: 'TODO: update the product copy',
    });
  });

  it('limits block parsing to Liquid file paths', () => {
    expect(isLiquidFilePath('/workspace/snippet.LIQUID')).to.equal(true);
    expect(isLiquidFilePath('/workspace/snippet.html')).to.equal(false);
  });

  it('does not expose synthetic closing tags on markers with no message', () => {
    const matches = parse('{% comment %}\n  TODO\n  FIXME:\n{% endcomment %}');
    expect(matches.map((match) => match.todo)).to.deep.equal(['TODO', 'FIXME:']);
  });

  it('preserves custom marker names and message captures without synthetic suffixes', () => {
    const matches = parseLiquidBlockCommentMatches(
      ['{% comment %}', '  CUSTOM: message', '{% endcomment %}'],
      /\{% comment %\} (CUSTOM): (.*)/g
    );
    expect(matches[0]).to.include({
      type: 'CUSTOM',
      message: 'message',
      todo: 'CUSTOM: message',
      column: 2,
    });
  });

  it('retains source coordinates on closing lines and same-line nested blocks', () => {
    const matches = parse(
      [
        '{% comment %}',
        '  TODO: first {% endcomment %} {% comment %} FIXME: second {% endcomment %}',
        'TODO: outside',
      ].join('\n')
    );
    expect(matches.map(({ type, column, lineNr }) => ({ type, column, lineNr }))).to.deep.equal([
      { type: 'TODO', column: 2, lineNr: 1 },
      { type: 'FIXME', column: 45, lineNr: 1 },
    ]);
  });

  it('does not let raw content close an enclosing comment', () => {
    const matches = parse(
      [
        '{% comment %}',
        '{% raw %}{% endcomment %}{% endraw %}',
        'TODO: still in the comment',
        '{% endcomment %}',
        'TODO: outside',
      ].join('\n')
    );
    expect(matches.map((match) => match.message)).to.deep.equal([' still in the comment']);
  });

  it('keeps the outer comment active after a nested comment closes', () => {
    const matches = parse(
      [
        '{% comment %}',
        'TODO: outer',
        '{% comment %}',
        'TODO: inner',
        '{% endcomment %}',
        'TODO: still outer',
        '{% endcomment %}',
        'TODO: outside',
      ].join('\n')
    );
    expect(matches.map((match) => match.message)).to.deep.equal([
      ' outer',
      ' inner',
      ' still outer',
    ]);
  });

  it('does not enter a comment from literal tags in a raw block', () => {
    const matches = parse(
      [
        '{% raw %}',
        '{% comment %}',
        'TODO: literal output',
        '{% endraw %}',
        'TODO: also outside',
      ].join('\n')
    );
    expect(matches).to.deep.equal([]);
  });

  it('ends raw blocks even when literal output contains unfinished delimiters', () => {
    const matches = parse(
      [
        '{% raw %} {{ literal {% endraw %}',
        '{% comment %}',
        'TODO: real comment',
        '{% endcomment %}',
      ].join('\n')
    );
    expect(matches.map((match) => match.message)).to.deep.equal([' real comment']);
  });

  it('handles nested comments and an opening-line comment in a liquid tag', () => {
    const matches = parse(
      [
        '{%- liquid comment',
        'TODO: outer',
        'comment',
        'TODO: inner',
        'endcomment',
        'TODO: still outer',
        'endcomment -%}',
        'TODO: outside',
      ].join('\n')
    );
    expect(matches.map((match) => match.message)).to.deep.equal([
      ' outer',
      ' inner',
      ' still outer',
    ]);
  });
});
