import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { isAllowedFilePath } from '../src/utils/file-discovery';
import { discoverTodoFiles, isTodoFileIncluded } from '../src/utils/todo-file-discovery';

describe('Explicit absolute Todo files', () => {
  let fixture: string;
  let workspace: string;
  let otherWorkspace: string;
  let globalFile: string;

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(process.cwd(), '.absolute-files-'));
    workspace = path.join(fixture, 'workspace');
    otherWorkspace = path.join(fixture, 'other');
    globalFile = path.join(fixture, '[personal] global.todo');
    fs.mkdirSync(workspace);
    fs.mkdirSync(otherWorkspace);
    fs.writeFileSync(globalFile, '☐ global task');
  });

  afterEach(() => {
    const remove = (entry: string) => {
      if (fs.lstatSync(entry).isDirectory()) {
        fs.readdirSync(entry).forEach((child) => remove(path.join(entry, child)));
        fs.rmdirSync(entry);
      } else {
        fs.unlinkSync(entry);
      }
    };
    expect(path.dirname(fixture)).to.equal(process.cwd());
    expect(path.basename(fixture)).to.match(/^\.absolute-files-/);
    remove(fixture);
  });

  const scan = (roots: string[], include: string[], exclude: string[] = [], follow = false) =>
    discoverTodoFiles(roots, include, exclude, follow, () => ({}));

  it('keeps a literal file alongside workspace globs, across roots and without a workspace', async () => {
    const localFile = path.join(workspace, 'local.todo');
    fs.writeFileSync(localFile, '☐ local task');
    fs.writeFileSync(path.join(fixture, 'unlisted.todo'), '☐ not included');
    const include = ['**/*.todo', globalFile];

    expect((await scan([workspace], include)).map(path.normalize)).to.have.members([
      localFile,
      globalFile,
    ]);
    expect((await scan([otherWorkspace], include)).map(path.normalize)).to.deep.equal([globalFile]);
    expect((await scan([], include)).map(path.normalize)).to.deep.equal([globalFile]);
  });

  it('includes absolute files inside a workspace and deduplicates glob and literal matches', async () => {
    const localFile = path.join(workspace, 'local.todo');
    fs.writeFileSync(localFile, '');

    expect((await scan([workspace], [localFile])).map(path.normalize)).to.deep.equal([localFile]);
    expect(
      (
        await scan([workspace, workspace], ['**/*.todo', localFile, localFile.replace(/\\/g, '/')])
      ).map(path.normalize)
    ).to.deep.equal([localFile]);
  });

  it('never includes an unlisted external file just because a relative glob matches it', async () => {
    expect(await scan([workspace], ['**/*.todo'])).to.deep.equal([]);
    expect(
      isTodoFileIncluded(globalFile, [workspace], ['**/*.todo'], [], true, () => ({}))
    ).to.equal(false);
    expect(isAllowedFilePath(globalFile, [workspace], true)).to.equal(false);
  });

  it('honors Todo exclusions, negative includes, and resource-specific file exclusions', async () => {
    expect(await scan([], [globalFile], ['**/*.todo'])).to.deep.equal([]);
    expect(await scan([], [globalFile, '!**/*.todo'])).to.deep.equal([]);
    const discover = (rules) =>
      discoverTodoFiles([], [globalFile], [], false, (resource) => {
        expect(path.normalize(resource)).to.equal(globalFile);
        return rules;
      });

    expect(await discover({ '**/*.todo': true })).to.deep.equal([]);
    expect((await discover({ '**/*.todo': false })).map(path.normalize)).to.deep.equal([
      globalFile,
    ]);
    fs.writeFileSync(path.join(fixture, '[personal] global.txt'), '');
    expect(await discover({ '**/*.todo': { when: '$(basename).txt' } })).to.deep.equal([]);
  });

  it('applies workspace exclusions relative to the root for an explicit internal file', async () => {
    const localFile = path.join(workspace, 'local.todo');
    fs.writeFileSync(localFile, '');

    expect(await scan([workspace], [localFile], ['local.todo'])).to.deep.equal([]);
    expect(
      await discoverTodoFiles([workspace], [localFile], [], false, () => ({ 'local.todo': true }))
    ).to.deep.equal([]);
  });

  it('skips missing files, directories, malformed paths, and absolute wildcard expressions', async () => {
    const include = [
      globalFile,
      workspace,
      path.join(fixture, 'missing.todo'),
      `${globalFile}\0`,
      path.join(fixture, '*.todo'),
    ];

    expect((await scan([], include)).map(path.normalize)).to.deep.equal([globalFile]);
  });

  it('rejects inaccessible entries without losing the other files', async () => {
    const unavailable = path.join(fixture, 'unavailable.todo');
    fs.writeFileSync(unavailable, '');
    const stat = fs.statSync;
    (fs as any).statSync = (entry, ...args) => {
      if (path.normalize(String(entry)) === unavailable) throw new Error('EACCES');
      return (stat as any)(entry, ...args);
    };

    try {
      expect((await scan([], [globalFile, unavailable])).map(path.normalize)).to.deep.equal([
        globalFile,
      ]);
    } finally {
      (fs as any).statSync = stat;
    }
  });

  it('requires opt-in for file and directory symlinks and deduplicates their real targets', async () => {
    const fileLink = path.join(fixture, 'linked.todo');
    const directoryLink = path.join(fixture, 'linked-directory');
    fs.symlinkSync(globalFile, fileLink, 'file');
    fs.symlinkSync(workspace, directoryLink, process.platform === 'win32' ? 'junction' : 'dir');
    const localFile = path.join(workspace, 'local.todo');
    const linkedFile = path.join(directoryLink, 'local.todo');
    fs.writeFileSync(localFile, '');

    expect(await scan([], [fileLink, linkedFile])).to.deep.equal([]);
    expect(
      (await scan([workspace], ['**/*.todo', globalFile, fileLink, linkedFile], [], true)).map(
        path.normalize
      )
    ).to.have.members([localFile, globalFile]);
  });
});
