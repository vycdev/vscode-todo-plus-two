import * as fs from 'fs';
import * as path from 'path';
import * as pify from 'pify';
import {
  ExcludeGlobs,
  expandDirectoryExcludeGlobs,
  findClosestRootPath,
  getEnabledExcludeGlobs,
  getFilePathKey,
  getGlobMatchOptions,
  isFileIncluded,
} from './file-globs';
import { flatMapFulfilled } from './promises';

export const isAllowedFilePath = (
  filePath: string,
  rootPaths: string[],
  followSymlinks: boolean
): boolean => {
  const rootPath = findClosestRootPath(filePath, rootPaths);

  if (!rootPath) return false;
  if (followSymlinks) return true;

  // Watchers and literal glob prefixes can bypass the glob walker's symlink checks.
  // Check the file and its ancestors through the workspace root as well.
  const root = path.resolve(rootPath);
  let current = path.resolve(filePath);

  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return false;
    } catch {
      return false;
    }

    if (getFilePathKey(root) === getFilePathKey(current)) return true;

    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
};

export const discoverFiles = async (
  rootPaths: string[],
  include: string[],
  exclude: string[],
  followSymlinks: boolean,
  getWorkspaceExcludes: (resourcePath: string) => ExcludeGlobs
): Promise<string[]> => {
  const globby = require('globby');
  const scans = await flatMapFulfilled<string, string>(
    rootPaths,
    (cwd) => {
      const patterns = followSymlinks
        ? include
        : include.filter((pattern) => {
            if (pattern.startsWith('!')) return true;
            const parts = pattern.split('/');
            const literal: string[] = [];
            for (const part of parts) {
              if (globby.hasMagic(part)) break;
              literal.push(part);
            }
            // A literal prefix is the walker's starting directory and
            // otherwise skips its normal symlink descent checks.
            return isAllowedFilePath(path.resolve(cwd, literal.join('/')), [cwd], false);
          });

      return globby(patterns, {
        cwd,
        ignore: expandDirectoryExcludeGlobs(
          exclude.concat(getEnabledExcludeGlobs(getWorkspaceExcludes(cwd)))
        ),
        ...getGlobMatchOptions(),
        absolute: true,
        // globby 8 uses fast-glob 2's option name.
        followSymlinkedDirectories: followSymlinks,
      });
    },
    (cwd, error) => console.warn(`Todo+: Could not scan ${cwd}`, error)
  );
  const seen = new Set<string>();
  const result: string[] = [];

  for (const filePath of scans) {
    if (
      !isAllowedFilePath(filePath, rootPaths, followSymlinks) ||
      !isFileIncluded(
        filePath,
        findClosestRootPath(filePath, rootPaths),
        include,
        exclude,
        getWorkspaceExcludes(filePath)
      )
    )
      continue;

    try {
      const realPath = await pify(fs.realpath)(filePath);
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      result.push(filePath);
    } catch {
      // Files can disappear during discovery.
    }
  }

  return result;
};
