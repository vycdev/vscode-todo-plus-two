import { expect } from 'chai';
import { DocumentLinesCache } from '../src/todo/decorators/document-lines-cache';

const change = (start: number, end: number, text: string): any => ({
  range: { start: { line: start }, end: { line: end } },
  text,
});
const fixture = (text: string) => {
  const document: any = {
    version: 1,
    get lineCount() {
      return text.split('\n').length;
    },
    lineAt: (line) => ({ text: text.split('\n')[line] }),
  };
  const parse = (value: string, line: number) => ({ value, line });
  const cache = new DocumentLinesCache(document, text, parse);
  return {
    cache,
    document,
    parse,
    setText: (value: string) => {
      text = value;
      document.version++;
    },
  };
};

describe('Document line cache', () => {
  it('keeps untouched line objects when a line is edited', () => {
    const { cache, document, parse, setText } = fixture('first\nsecond\nthird');
    const previous = [...cache.lines];
    setText('first\nchanged\nthird');
    cache.update(document, [change(1, 1, 'changed')], parse);
    expect(cache.lines[0]).to.equal(previous[0]);
    expect(cache.lines[2]).to.equal(previous[2]);
    expect(cache.lines[1].value).to.equal('changed');
  });

  it('maps simultaneous line insertions from old coordinates to final coordinates', () => {
    const { cache, document, parse, setText } = fixture('first\nsecond\nthird');
    const last = cache.lines[2];
    setText('first\nnew\nsecond\nother\nthird');
    const result = cache.update(document, [change(1, 1, '\n'), change(0, 0, '\n')], parse);
    expect(result.added.map((line) => line.value)).to.deep.equal([
      'first',
      'new',
      'second',
      'other',
    ]);
    expect(cache.lines[4]).to.equal(last);
  });

  it('merges multiple edits on one old line and reads each new line once', () => {
    const { cache, document, setText } = fixture('first\nsecond');
    setText('one\ntwo\nsecond');
    let parsed = 0;
    cache.update(document, [change(0, 0, '\n'), change(0, 0, 'x')], (value, line) => {
      parsed++;
      return { value, line };
    });
    expect(parsed).to.equal(2);
    expect(cache.lines.map((line) => line.value)).to.deep.equal(['one', 'two', 'second']);
  });

  it('does not partially commit an unsafe batch', () => {
    const { cache, document, setText } = fixture('first\nsecond');
    const previous = [...cache.lines];
    setText('changed\nunsafe');
    const result = cache.update(
      document,
      [change(0, 0, 'changed'), change(1, 1, 'unsafe')],
      (value, line) => (value === 'unsafe' ? undefined : { value, line })
    );
    expect(result).to.equal(undefined);
    expect(cache.lines).to.deep.equal(previous);
  });

  it('rejects missed versions and inconsistent line counts', () => {
    const { cache, document, parse, setText } = fixture('first\nsecond');
    setText('changed\nextra\nsecond');
    expect(cache.update(document, [change(0, 0, 'changed')], parse)).to.equal(undefined);
    document.version++;
    expect(cache.update(document, [change(0, 0, 'changed\nextra')], parse)).to.equal(undefined);
  });
});
