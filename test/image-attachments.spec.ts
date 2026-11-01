import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkImageAttachmentPath, createImageAttachment } from '../src/utils/image-attachments';
import { findRelativeFileLinks } from '../src/utils/file-links';

describe('Image attachment paths', () => {
  it('resolves generated image links to the original attachment path', () => {
    const documentPath = path.resolve(path.sep, 'workspace', 'My tasks (#1).todo');
    const attachment = createImageAttachment(documentPath, '.png');
    const [link] = findRelativeFileLinks(attachment.link, documentPath);
    expect(link.targetPath).to.equal(attachment.filePath);
  });

  it('does not create the assets folder when checking a new attachment', () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'todo-image-'));
    try {
      const attachment = createImageAttachment(path.join(directory, 'tasks.todo'), '.jpg');
      checkImageAttachmentPath(attachment.filePath, false);
      expect(fs.existsSync(path.dirname(attachment.filePath))).to.equal(false);
    } finally {
      fs.rmdirSync(directory);
    }
  });

  it('rejects symlinked asset directories unless following symlinks is enabled', () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'todo-image-'));
    const target = path.join(directory, 'target');
    const assets = path.join(directory, 'tasks.todo.assets');
    fs.mkdirSync(target);
    try {
      fs.symlinkSync(target, assets, process.platform === 'win32' ? 'junction' : 'dir');
      const filePath = path.join(assets, 'image.png');
      expect(() => checkImageAttachmentPath(filePath, false)).to.throw('symbolic link');
      expect(() => checkImageAttachmentPath(filePath, true)).not.to.throw();
      expect(() =>
        checkImageAttachmentPath(path.join(assets, 'nested', 'image.png'), false)
      ).to.throw('symbolic link');
    } finally {
      if (fs.existsSync(assets)) fs.unlinkSync(assets);
      fs.rmdirSync(target);
      fs.rmdirSync(directory);
    }
  });
});
