import * as path from 'path';
import * as _ from 'lodash';

// Exercise the real parser, statistics and decorators without an Extension Host.
export const withDecorationEditor = (text: string, run) => {
  const Module = require('module'),
    originalLoad = Module._load,
    sourceRoot = path.resolve(__dirname, '../../src') + path.sep,
    previous = Object.keys(require.cache)
      .filter((filename) => filename.startsWith(sourceRoot))
      .map((filename) => [filename, require.cache[filename]] as const),
    config = {};

  previous.forEach(([filename]) => delete require.cache[filename]);
  Object.entries(require('../../package.json').contributes.configuration.properties).forEach(
    ([key, value]: [string, any]) => _.set(config, key.replace(/^todo\./, ''), value.default)
  );

  class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  }
  class Range {
    start;
    end;
    constructor(start, characterOrEnd, endLine?, endCharacter?) {
      this.start = typeof start === 'number' ? new Position(start, characterOrEnd) : start;
      this.end = typeof start === 'number' ? new Position(endLine, endCharacter) : characterOrEnd;
    }
    get isSingleLine() {
      return this.start.line === this.end.line;
    }
  }
  let lines: string[], offsets: number[];
  const setText = (value: string) => {
    text = value;
    lines = text.split('\n');
    let offset = 0;
    offsets = lines.map((line) => {
      const start = offset;
      offset += line.length + 1;
      return start;
    });
  };
  setText(text);
  const calls = {
    fullText: 0,
    lines: 0,
    decorations: 0,
    timer: 0,
    statistics: 0,
    parses: 0,
    decorationBuilds: 0,
    projectComputations: 0,
    contributions: 0,
  };
  const document = {
    languageId: 'todo',
    version: 1,
    get eol() {
      return text.includes('\r\n') ? 2 : 1;
    },
    uri: { fsPath: '/test.todo' },
    getText: () => {
      calls.fullText++;
      return text;
    },
    get lineCount() {
      return lines.length;
    },
    lineAt: (lineNumber) => {
      calls.lines++;
      const lineText = lines[lineNumber].replace(/\r$/, '');
      return {
        lineNumber,
        text: lineText,
        range: new Range(lineNumber, 0, lineNumber, lineText.length),
      };
    },
    positionAt: (offset) => {
      let low = 0,
        high = offsets.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (offsets[middle] <= offset) low = middle;
        else high = middle - 1;
      }
      return new Position(low, offset - offsets[low]);
    },
  };
  const decorations = new Map();
  const editor = {
    document,
    options: { tabSize: 2, insertSpaces: true },
    setDecorations: (type, ranges) => {
      calls.decorations++;
      decorations.set(type, ranges);
    },
  };
  const window = {
    activeTextEditor: editor,
    visibleTextEditors: [editor],
    createTextEditorDecorationType: (options) => ({
      options,
      disposed: false,
      dispose() {
        this.disposed = true;
      },
    }),
  };
  const utils: any = {
    editor: { isSupported: (item) => item && item.document.languageId === 'todo' },
  };
  Module._load = (request, parent, isMain) => {
    if (request === 'vscode')
      return {
        window,
        Position,
        Range,
        EndOfLine: { LF: 1, CRLF: 2 },
        DecorationRangeBehavior: { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 },
      };
    if (/^(?:\.\.\/|\.\/)+config$/.test(request))
      return { default: { get: () => config, getKey: (key) => _.get(config, key) } };
    if (/^(\.\.\/)+utils$/.test(request)) return { default: utils };
    if (request === '../../statusbars/timer') return { default: { update: () => calls.timer++ } };
    if (request === '../../statusbars/statistics')
      return { default: { update: () => calls.statistics++ } };
    return originalLoad(request, parent, isMain);
  };
  try {
    utils.regex = require('../../src/utils/regex').default;
    utils.statistics = require('../../src/utils/statistics').default;
    utils.statistics.tokens.updateDisabledAll();
    const createGlobal = utils.statistics.tokens.createGlobal,
      updateProject = utils.statistics.tokens.updateProject;
    utils.statistics.tokens.createGlobal = (...args) => {
      calls.contributions++;
      return createGlobal(...args);
    };
    utils.statistics.tokens.updateProject = (...args) => {
      if (!utils.statistics.tokens.projects[args[1].lineNumber]) calls.projectComputations++;
      return updateProject(...args);
    };
    const decorator = require('../../src/todo/decorators/document').default,
      changes = require('../../src/todo/decorators/changes').default;
    const getItems = decorator.getItems,
      getItemsDecorations = decorator.getItemsDecorations;
    decorator.getItems = (...args) => {
      calls.parses++;
      return getItems(...args);
    };
    decorator.getItemsDecorations = (...args) => {
      calls.decorationBuilds++;
      return getItemsDecorations(...args);
    };
    const edit = (lineNumber, start, end, replacement) => {
      const lines = text.split('\n');
      lines[lineNumber] =
        lines[lineNumber].slice(0, start) + replacement + lines[lineNumber].slice(end);
      setText(lines.join('\n'));
      document.version++;
      changes.onChanges({
        document,
        contentChanges: [
          { range: new Range(lineNumber, start, lineNumber, end), text: replacement },
        ],
      });
    };
    run({
      decorator,
      changes,
      editor,
      window,
      config,
      calls,
      decorations,
      utils,
      getText: () => text,
      edit,
      Range,
      setText: (value) => {
        setText(value);
        document.version++;
      },
    });
  } finally {
    Module._load = originalLoad;
    Object.keys(require.cache)
      .filter((filename) => filename.startsWith(sourceRoot))
      .forEach((filename) => delete require.cache[filename]);
    previous.forEach(([filename, cached]) => (require.cache[filename] = cached));
  }
};
