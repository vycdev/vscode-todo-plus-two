import { expect } from 'chai';
import { parseCodeBlocks } from '../src/utils/code-blocks';

const loadSymbols = () => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    subjectPath = require.resolve('../src/providers/symbols'),
    previous = require.cache[subjectPath];
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
      return this.textDocument.lines
        .map((text, lineNumber) => ({
          line: { text },
          range: new Range(lineNumber, 0, lineNumber, text.length),
        }))
        .filter(
          (project) =>
            !parseCodeBlocks(this.textDocument.lines.join('\n')).byLine.has(
              project.range.start.line
            ) && /:$/.test(project.line.text)
        );
    }
  }
  const level = (text) => text.length - text.trimStart().length;
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode') return { Range, DocumentSymbol, SymbolKind: { Field: 1 } };
    if (request === '../todo/document') return { default: Document };
    if (request === '../consts') return { default: { regexes: { projectParts: /^(\s*)(.*):$/ } } };
    if (request === '../utils')
      return {
        default: {
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
    return require(subjectPath).default;
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    if (previous) require.cache[subjectPath] = previous;
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
