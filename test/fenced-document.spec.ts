import { expect } from 'chai';

const withDocument = (run: (Document: any) => void) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const subjects = [require.resolve('../src/consts'), require.resolve('../src/todo/document')];
  const itemDirectory = require('path').dirname(require.resolve('../src/todo/items'));
  const saved = new Map(
    Object.keys(require.cache)
      .filter(
        (path) =>
          subjects.indexOf(path) >= 0 || path.startsWith(itemDirectory + require('path').sep)
      )
      .map((path) => [path, require.cache[path]])
  );
  saved.forEach((_value, path) => delete require.cache[path]);
  const utils = {
    regex: require('../src/utils/regex').default,
    editor: { isSupported: () => true },
  };
  const config = { get: () => ({}), getKey: () => undefined };
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode')
      return { window: { visibleTextEditors: [], showErrorMessage: () => undefined } };
    if (['../utils', '../../utils'].indexOf(request) >= 0) return { default: utils };
    if (['./config', '../config', '../../config'].indexOf(request) >= 0) return { default: config };
    return originalLoad(request, parent, isMain);
  };
  try {
    run(require('../src/todo/document').default);
  } finally {
    NodeModule._load = originalLoad;
    Object.keys(require.cache)
      .filter(
        (path) =>
          subjects.indexOf(path) >= 0 || path.startsWith(itemDirectory + require('path').sep)
      )
      .forEach((path) => delete require.cache[path]);
    saved.forEach((value, path) => (require.cache[path] = value));
  }
};

describe('Fenced Todo document parsing', () => {
  const text = [
    'Work:',
    '☐ real @id(real)',
    '```ts',
    'Archive:',
    '☐ fake @id(fake) @due(2026-01-01)',
    '*bold* `code` @tag',
    '```',
    'Archive:',
  ].join('\n');

  it('excludes fenced projects, tasks, tags and formatting in text-only parsing', () => {
    withDocument((Document) => {
      const doc = new Document(text);
      expect(doc.getTodos().map((todo) => todo.text)).to.deep.equal(['☐ real @id(real)']);
      expect(doc.getProjects().map((project) => project.text)).to.deep.equal(['Work:', 'Archive:']);
      expect(doc.getTags().map((tag) => tag.text)).to.deep.equal(['@id(real)']);
      expect(doc.getTagsDue()).to.deep.equal([]);
      expect(doc.getFormatted()).to.deep.equal([]);
      expect(doc.getComments()).to.deep.equal([]);
      expect(doc.getArchive().match.index).to.equal(text.lastIndexOf('Archive:'));
    });
  });

  it('rejects task commands inside fences even when validity checks are disabled', () => {
    withDocument((Document) => {
      const lines = text.split('\n');
      const document = {
        version: 1,
        getText: () => text,
        lineAt: (line: number) => ({ text: lines[line], lineNumber: line }),
      };
      const doc = new Document(document);
      expect(doc.getTodoAt(4, false)).to.equal(undefined);
      expect(doc.getProjectAt(3)).to.equal(undefined);
      expect(doc.getCommentAt(5)).to.equal(undefined);
      expect(doc.getTodoAt(1)).not.to.equal(undefined);
      expect(doc.getLineAt(4).text).to.equal(lines[4]);
    });
  });
});
