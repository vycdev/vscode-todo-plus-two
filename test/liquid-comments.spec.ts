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
});
