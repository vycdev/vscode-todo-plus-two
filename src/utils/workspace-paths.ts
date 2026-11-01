import * as fs from 'fs';
import * as path from 'path';
import { findClosestRootPath, getFilePathKey, isPathWithinRoot } from './file-globs';

const replaceRoot = (filePath: string, from: string, to: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const root = from.replace(/\\/g, '/').replace(/\/+$/, '');
  const relative = normalized.slice(root.length).replace(/^\/+/, '');

  return path.join(to, relative).replace(/\\/g, '/');
};

export const createWorkspacePathResolver = (rootPaths: string[]) => {
  const resolveRoot = (rootPath: string): string => {
    try {
      return fs.realpathSync(rootPath);
    } catch {
      // An unavailable root keeps its existing lexical path matching.
      return rootPath;
    }
  };
  const roots = rootPaths.map((rootPath) => ({ rootPath, realPath: resolveRoot(rootPath) }));

  const getRealPath = (filePath: string): string => {
    const rootPath = findClosestRootPath(filePath, rootPaths);
    const root = roots.find((entry) => entry.rootPath === rootPath);

    // Resolve only the workspace root, preserving symlinks below it so the
    // normal discovery and inclusion checks still enforce followSymlinks.
    return root ? replaceRoot(filePath, root.rootPath, root.realPath) : filePath;
  };

  return {
    rootPaths: rootPaths.slice(),
    refresh(): boolean {
      let changed = false;

      roots.forEach((root) => {
        const realPath = resolveRoot(root.rootPath);
        if (getFilePathKey(realPath) !== getFilePathKey(root.realPath)) changed = true;
        root.realPath = realPath;
      });

      return changed;
    },
    getKey: (filePath: string): string => getFilePathKey(getRealPath(filePath)),
    getWorkspacePaths(filePath: string): string[] {
      const realPath = getRealPath(filePath);

      return roots
        .filter((root) => isPathWithinRoot(realPath, root.realPath))
        .map((root) => replaceRoot(realPath, root.realPath, root.rootPath));
    },
  };
};
