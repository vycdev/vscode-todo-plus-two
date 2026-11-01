import { expect } from 'chai';
import * as path from 'path';
import { findRelativeFileLinks } from '../src/utils/file-links';

const archiveImages = async (
  archiveType: string,
  projects = ['Work'],
  existingContent = 'Archive:\n  Existing file://./existing.png\n'
) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve('../src/utils/archive');
  const previous = require.cache[modulePath];
  const rootPath = path.resolve(path.sep, 'workspace');
  const sourcePath = path.join(rootPath, 'todos', 'tasks.todo');
  const text = '  ✔ Done file://./tasks.todo.assets/image.png\n    Note file://../shared/image.jpg';
  const item = { text, projects };
  const transfers: { archivePath: string; content: string }[] = [];
  const config = { file: { name: 'TODO' }, indentation: '  ' };
  NodeModule._load = (request, parent, isMain) => {
    if (parent && parent.filename === modulePath) {
      if (request === 'vscode') return { EndOfLine: { CRLF: 2 } };
      if (request === '../todo/items') return { Todo: { is: (line) => /^\s*✔/.test(line) } };
      if (request === '../todo/document') return {};
      if (request === '../config')
        return {
          default: {
            get: () => config,
            getKey: (key) => (key === 'archive.type' ? archiveType : false),
          },
        };
      if (request === '../consts')
        return {
          default: { regexes: { todoFinished: /^\s*✔.*$/gm, tagFinished: /@done\(([^)]*)\)/ } },
        };
      if (request === './ast') return { default: {} };
      if (request === './index') return { default: { log: { debug() {} } } };
      if (request === './editor')
        return { default: { edits: { makeDeleteLine: (line) => ({ line }) } } };
      if (request === './folder') return { default: { getRootPath: () => rootPath } };
      if (request === './archive-storage')
        return {
          archiveToFile: async (archivePath, _document, _edits, merge) => {
            transfers.push({
              archivePath,
              content: merge(existingContent),
            });
          },
        };
      if (request === '../todo/decorators/document') return { default: { update() {} } };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[modulePath];
    const archive = require(modulePath).default;
    await archive.edit(
      {
        textDocument: { uri: { fsPath: sourcePath }, eol: 1 },
        textEditor: { options: { insertSpaces: true, tabSize: 2 } },
      },
      { remove: [{ lineNumber: 1 }], insert: { 1: item } }
    );
    return { ...transfers[0], sourcePath, sourceText: text, item };
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

describe('Archived image links', () => {
  it('rebases task and attached-note links when archiving to the workspace root', async () => {
    const result = await archiveImages('InSeparateFile');
    expect(result.content).to.include('file://./todos/tasks.todo.assets/image.png');
    expect(result.content).to.include('file://./shared/image.jpg');
    expect(result.content).to.include('Existing file://./existing.png');
    const targets = findRelativeFileLinks(result.content, result.archivePath).map(
      (link) => link.targetPath
    );
    const originals = findRelativeFileLinks(result.sourceText, result.sourcePath).map(
      (link) => link.targetPath
    );
    expect(targets).to.include.members(originals);
    expect(result.item.text).to.equal(result.sourceText);
  });

  it('preserves task and attached-note links in per-file archives', async () => {
    const result = await archiveImages('InMultiSeparateFile');
    expect(path.dirname(result.archivePath)).to.equal(path.dirname(result.sourcePath));
    expect(result.content).to.include('file://./tasks.todo.assets/image.png');
    expect(result.content).to.include('file://../shared/image.jpg');
  });

  it('rebases project-header attachments and reuses their headers across archives', async () => {
    const projects = ['Work <file://./tasks.todo.assets/project.png>', 'Child'];
    const first = await archiveImages('InSeparateFile', projects);
    const header = 'Work <file://./todos/tasks.todo.assets/project.png>:';
    expect(first.content).to.include(header);
    expect(first.item.projects).to.deep.equal(projects);
    const second = await archiveImages('InSeparateFile', projects, first.content);
    expect(second.content.split(header)).to.have.length(2);
    expect(second.content.split('Child:')).to.have.length(2);
    expect(second.content).to.include('file://./todos/tasks.todo.assets/image.png');
  });
});
