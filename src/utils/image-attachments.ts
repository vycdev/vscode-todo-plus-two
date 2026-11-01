import { randomBytes } from 'crypto';
import { lstatSync } from 'fs';
import * as path from 'path';
import { makeRelativeFileLink } from './file-links';

export const getImageExtension = (mime: string, name: string): string | undefined => {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime.startsWith('image/')) return;
  const extension = path.extname(name).toLowerCase();
  if (['.png', '.jpg', '.jpeg'].includes(extension)) return extension;
};

export const createImageAttachment = (documentPath: string, extension: string) => {
  const filePath = path.join(
    path.dirname(documentPath),
    `${path.basename(documentPath)}.assets`,
    `image-${randomBytes(16).toString('hex')}${extension}`
  );
  return { filePath, link: makeRelativeFileLink(documentPath, filePath) };
};

export const checkImageAttachmentPath = (filePath: string, followSymlinks: boolean): void => {
  if (followSymlinks) return;
  let current = path.dirname(filePath);
  while (true) {
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(
          'The image destination uses a symbolic link. Enable todo.followSymlinks to use it'
        );
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
};
