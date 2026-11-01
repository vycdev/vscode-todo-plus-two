import * as fs from 'fs';
import * as path from 'path';
import * as pify from 'pify';
import { discoverFiles, isAllowedFilePath } from './file-discovery';
import { ExcludeGlobs, findClosestRootPath, getFilePathKey, isFileIncluded } from './file-globs';

export const getAbsoluteFilePaths = (include: string[] = []): string[] => {
  const files = new Map<string, string>();

  include
    .filter((entry) => path.isAbsolute(entry) && !entry.includes('\0'))
    .forEach((entry) => {
      const filePath = path.resolve(entry).replace(/\\/g, '/');
      const key = getFilePathKey(filePath);
      if (!files.has(key)) files.set(key, filePath);
    });

  return Array.from(files.values());
};

export const isTodoFileIncluded = (
  filePath: string,
  rootPaths: string[],
  include: string[],
  exclude: string[],
  followSymlinks: boolean,
  getWorkspaceExcludes: (resourcePath: string) => ExcludeGlobs
): boolean => {
  const explicit = getAbsoluteFilePaths(include).some(
    (entry) => getFilePathKey(entry) === getFilePathKey(filePath)
  );
  const rootPath = findClosestRootPath(filePath, rootPaths);
  // Explicit files may live outside a workspace, but their symlink ancestors
  // must still obey the same policy as files found by a workspace walk.
  const allowedRoots = explicit ? [rootPath || path.parse(filePath).root] : rootPaths;

  if (!isAllowedFilePath(filePath, allowedRoots, followSymlinks)) return false;

  if (explicit) {
    try {
      if (!fs.statSync(filePath).isFile()) return false;
    } catch {
      return false;
    }
  }

  return isFileIncluded(
    filePath,
    rootPath,
    explicit
      ? ['**/*', ...include.filter((entry) => entry.startsWith('!'))]
      : include.filter((entry) => !path.isAbsolute(entry)),
    exclude,
    getWorkspaceExcludes(filePath)
  );
};

export const discoverTodoFiles = async (
  rootPaths: string[],
  include: string[],
  exclude: string[],
  followSymlinks: boolean,
  getWorkspaceExcludes: (resourcePath: string) => ExcludeGlobs
): Promise<string[]> => {
  const workspaceFiles = await discoverFiles(
    rootPaths,
    include.filter((entry) => !path.isAbsolute(entry)),
    exclude,
    followSymlinks,
    getWorkspaceExcludes
  );
  const absoluteFiles = getAbsoluteFilePaths(include);
  if (!absoluteFiles.length) return workspaceFiles.map((filePath) => filePath.replace(/\\/g, '/'));

  const explicitFiles = absoluteFiles.filter((filePath) =>
    isTodoFileIncluded(filePath, rootPaths, include, exclude, followSymlinks, getWorkspaceExcludes)
  );
  const seen = new Set<string>();
  const files: string[] = [];

  for (const filePath of workspaceFiles.concat(explicitFiles)) {
    try {
      const key = getFilePathKey(await pify(fs.realpath)(filePath));
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(filePath.replace(/\\/g, '/'));
    } catch {
      // A missing or inaccessible file must not hide the other results.
    }
  }

  return files;
};
