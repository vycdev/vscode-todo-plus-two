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
