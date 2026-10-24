import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { discoverFiles, isAllowedFilePath } from '../src/utils/file-discovery';

describe('File discovery symlink policy', () => {
  it('excludes directory symlinks by default, including literal prefixes and watcher paths', async () => {
    const fixture = fs.mkdtempSync(path.join(process.cwd(), '.file-discovery-'));
    const workspace = path.join(fixture, 'workspace');
    const external = path.join(fixture, 'external');
    const link = path.join(workspace, 'linked');
    const normalFile = path.join(workspace, 'tasks.todo');
    const linkedFile = path.join(link, 'external.todo');
    fs.mkdirSync(workspace);
    fs.mkdirSync(external);
    fs.writeFileSync(normalFile, 'local');
    fs.writeFileSync(path.join(external, 'external.todo'), 'external');
    fs.symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');

    try {
      const scan = (include: string[], follow: boolean) =>
        discoverFiles([workspace], include, [], follow, () => ({}));

      expect((await scan(['**/*.todo'], false)).map(path.normalize)).to.deep.equal([normalFile]);
      expect(await scan(['linked/**/*.todo'], false)).to.deep.equal([]);
      expect((await scan(['**/*.todo'], true)).map(path.normalize)).to.have.members([
        normalFile,
        linkedFile,
      ]);
      expect(isAllowedFilePath(linkedFile, [workspace], false)).to.equal(false);
      expect(isAllowedFilePath(linkedFile, [workspace], true)).to.equal(true);
      expect(isAllowedFilePath(path.join(external, 'external.todo'), [workspace], true)).to.equal(
        false
      );
    } finally {
      fs.unlinkSync(link);
      fs.unlinkSync(normalFile);
      fs.unlinkSync(path.join(external, 'external.todo'));
      fs.rmdirSync(workspace);
      fs.rmdirSync(external);
      fs.rmdirSync(fixture);
    }
  });
});

describe('File discovery exclude pruning', () => {
  const writeFile = (filePath: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
  };
  const removeDir = (dirPath: string) => {
    for (const entry of fs.readdirSync(dirPath)) {
      const entryPath = path.join(dirPath, entry);
      if (fs.lstatSync(entryPath).isDirectory()) removeDir(entryPath);
      else fs.unlinkSync(entryPath);
    }
    fs.rmdirSync(dirPath);
  };

  it('walks each directory once and never descends into excluded directories', async () => {
    const fixture = fs.mkdtempSync(path.join(process.cwd(), '.file-discovery-'));
    const workspace = path.join(fixture, 'workspace');
    const expected = [
      path.join(workspace, 'TODO'),
      path.join(workspace, 'tasks.todo'),
      path.join(workspace, 'sub', 'nested.todo'),
    ];
    expected.forEach(writeFile);
    writeFile(path.join(workspace, 'node_modules', 'pkg', 'deep', 'hidden.todo'));
    writeFile(path.join(workspace, 'build', 'out', 'hidden.todo'));
    writeFile(path.join(workspace, '.git', 'objects', 'hidden.todo'));

    const readdir = fs.readdir;
    const reads: string[] = [];
    (fs as any).readdir = function (dirPath: fs.PathLike, ...args: any[]) {
      reads.push(path.relative(workspace, path.resolve(String(dirPath))).replace(/\\/g, '/'));
      return (readdir as any).call(this, dirPath, ...args);
    };

    try {
      const files = await discoverFiles(
        [workspace],
        ['**/TODO', '**/*.todo', '**/*.taskpaper'],
        ['**/node_modules/**', '**/build/**'],
        false,
        () => ({ '**/.git': true })
      );

      expect(files.map(path.normalize)).to.have.members(expected);
      // An excluded directory may be listed, but none of its subdirectories are read.
      expect(
        reads.filter((dirPath) => /^(node_modules|build|\.git)\//.test(dirPath))
      ).to.deep.equal([]);
      expect(reads.filter((dirPath, index) => reads.indexOf(dirPath) !== index)).to.deep.equal([]);
    } finally {
      (fs as any).readdir = readdir;
      removeDir(fixture);
    }
  });

  it('does not apply excludes to folders above the workspace root', async () => {
    const fixture = fs.mkdtempSync(path.join(process.cwd(), '.file-discovery-'));
    const workspace = path.join(fixture, 'out', 'workspace');
    const expected = [path.join(workspace, 'tasks.todo'), path.join(workspace, 'sub', 'TODO')];
    expected.forEach(writeFile);
    writeFile(path.join(workspace, 'out', 'hidden.todo'));

    try {
      const files = await discoverFiles(
        [workspace],
        ['**/TODO', '**/*.todo'],
        ['**/out/**'],
        false,
        () => ({})
      );

      expect(files.map(path.normalize)).to.have.members(expected);
    } finally {
      removeDir(fixture);
    }
  });
});
