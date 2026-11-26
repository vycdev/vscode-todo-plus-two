import { expect } from 'chai';
import stringMatches from 'string-matches';
import { parseCodeBlocks } from '../src/utils/code-blocks';
import Regex from '../src/utils/regex';

const loadSymbols = () => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    subjectPath = require.resolve('../src/providers/symbols'),
    previous = require.cache[subjectPath],
    constsPath = require.resolve('../src/consts'),
    previousConsts = require.cache[constsPath];
  let projectPattern: RegExp;
  class Range {
    start;
    end;
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }
  class DocumentSymbol {
    children = [];
    constructor(
      public name,
      public detail,
      public kind,
      public range,
      public selectionRange
    ) {}
  }
  class Document {
    constructor(public textDocument) {}
    getProjects() {
      const { maskedText } = parseCodeBlocks(this.textDocument.getText());
      return stringMatches(maskedText, projectPattern).map((match) => {
        const { start, end } = Regex.match2range(match),
          lineStart = maskedText.lastIndexOf('\n', start - 1) + 1,
          lineNumber = maskedText.slice(0, start).split('\n').length - 1;
        return {
          line: this.textDocument.lineAt(lineNumber),
          range: new Range(lineNumber, start - lineStart, lineNumber, end - lineStart),
          text: match[1],
        };
      });
    }
  }
  const level = (text) => text.length - text.trimStart().length;
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode') return { Range, DocumentSymbol, SymbolKind: { Field: 1 } };
    if (request === '../todo/document') return { default: Document };
    if (request === './config' && parent.filename === constsPath)
      return { default: { get: () => ({}) } };
    if (request === '../utils')
      return {
        default: {
          regex: Regex,
          ast: {
            getLevel: (_document, text) => level(text),
            walkDown: (document, start, _skipStart, _ignoreEmpty, callback) => {
              for (let index = start + 1; index < document.lines.length; index++) {
                if (
                  callback({
                    startLevel: level(document.lines[start]),
                    level: level(document.lines[index]),
                    line: { lineNumber: index },
                  }) === false
                )
                  break;
              }
            },
          },
        },
      };
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[subjectPath];
    delete require.cache[constsPath];
    projectPattern = require(constsPath).default.regexes.project;
    return require(subjectPath).default;
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    if (previous) require.cache[subjectPath] = previous;
    delete require.cache[constsPath];
    if (previousConsts) require.cache[constsPath] = previousConsts;
  }
};

describe('Project document symbols', () => {
  const documentFromLines = (lines: string[]) => ({
    lines,
    lineCount: lines.length,
    getText: () => lines.join('\n'),
    lineAt: (lineNumber: number) => ({
      text: lines[lineNumber],
      range: { end: { character: lines[lineNumber].length } },
    }),
  });

  it('includes trailing fenced notes in a project range without adding fake project symbols', () => {
    const Symbols = loadSymbols();
    const symbols = new Symbols().provideDocumentSymbols(
      documentFromLines(['Work:', '  ```python', 'Archive:', '  ```', 'Next:'])
    );
    expect(symbols.map((symbol) => symbol.name)).to.deep.equal(['Work', 'Next']);
    expect(symbols[0].range.end.line).to.equal(3);
  });
  it('keeps colons in trailing tag arguments out of project symbol names', () => {
    const Symbols = loadSymbols();
    const symbols = new Symbols().provideDocumentSymbols(
      documentFromLines(['Release: API: @note(Review at 14:30)', '  Checklist:', 'Next:'])
    );

    expect(symbols.map((symbol) => symbol.name)).to.deep.equal(['Release: API', 'Next']);
    expect(symbols[0].children.map((symbol) => symbol.name)).to.deep.equal(['Checklist']);
    expect(symbols[0].selectionRange.end).to.deep.equal({ line: 0, character: 13 });
  });
  it('keeps tag-like values after argument colons out of project symbol names', () => {
    const Symbols = loadSymbols();
    const symbols = new Symbols().provideDocumentSymbols(
      documentFromLines([
        'Release: API: @high @note(Reviewer: @alice) @note(Owner: @bob)',
        '  Checklist @note(Owner: @alice):',
        'Next:',
      ])
    );

    expect(symbols.map((symbol) => symbol.name)).to.deep.equal(['Release: API', 'Next']);
    expect(symbols[0].children.map((symbol) => symbol.name)).to.deep.equal([
      'Checklist @note(Owner: @alice)',
    ]);
    expect(symbols[0].selectionRange.end).to.deep.equal({ line: 0, character: 56 });
  });
  it('preserves project titles with colons in bare tags', () => {
    const Symbols = loadSymbols();
    const symbols = new Symbols().provideDocumentSymbols(documentFromLines(['Release: @foo:@bar']));

    expect(symbols.map((symbol) => symbol.name)).to.deep.equal(['Release: @foo']);
  });
  it('does not parent projects under a previous project whose scope has ended', () => {
    const Symbols = loadSymbols();
    const lines = ['First:', '  Nested:', '    task', 'root task', '  Later:', '    task'];
    const document = documentFromLines(lines);
    const symbols = new Symbols().provideDocumentSymbols(document);

    expect(symbols.map((symbol) => symbol.name)).to.deep.equal(['First', 'Later']);
    expect(symbols[0].children.map((symbol) => symbol.name)).to.deep.equal(['Nested']);
    expect(symbols[1].children).to.deep.equal([]);
  });
});
