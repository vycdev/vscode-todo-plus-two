import { expect } from 'chai';

const loadLine = () => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load;
  const subjectPath = require.resolve('../src/todo/decorators/line');
  const previous = require.cache[subjectPath];
  class Range {
    start;
    end;
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode') return { Range };
    if (request === '../../utils')
      return {
        default: {
          regex: {
            matches2ranges: (matches) =>
              matches.map((match) => ({
                start: match.index,
                end: match.index + match[0].length,
              })),
          },
        },
      };
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[subjectPath];
    return { Line: require(subjectPath).default, Range };
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    if (previous) require.cache[subjectPath] = previous;
  }
};

describe('Decoration range subtraction', () => {
  it('distinguishes absolute editor ranges from relative regex matches', () => {
    const { Line, Range } = loadLine();
    const positive = new Range(2, 4, 2, 14);
    const expected = [new Range(2, 4, 2, 6), new Range(2, 8, 2, 14)];

    expect(
      new Line().getRangeDifference('abXXefghij', positive, [new Range(2, 6, 2, 8)])
    ).to.deep.equal(expected);
    expect(new Line().getRangeDifference('abXXefghij', positive, [/XX/g])).to.deep.equal(expected);
  });

  it('ignores exclusions from another line and clips multiline exclusions', () => {
    const { Line, Range } = loadLine();
    const positive = new Range(2, 4, 2, 14);

    expect(
      new Line().getRangeDifference('abcdefghij', positive, [new Range(0, 6, 0, 8)])
    ).to.deep.equal([positive]);
    expect(
      new Line().getRangeDifference('abcdefghij', positive, [new Range(1, 0, 2, 8)])
    ).to.deep.equal([new Range(2, 8, 2, 14)]);
  });

  it('merges overlapping exclusions and retains single-character segments', () => {
    const { Line, Range } = loadLine();
    expect(
      new Line().getRangeDifference('abcdefghij', new Range(0, 0, 0, 10), [
        new Range(0, 1, 0, 6),
        new Range(0, 4, 0, 9),
      ])
    ).to.deep.equal([new Range(0, 0, 0, 1), new Range(0, 9, 0, 10)]);
  });
});
