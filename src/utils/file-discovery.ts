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
  const fastGlob = require('fast-glob');
  const scans = await flatMapFulfilled<string, string>(
    rootPaths,
    async (cwd) => {
      const options = {
        cwd,
        ignore: expandDirectoryExcludeGlobs(
          exclude.concat(getEnabledExcludeGlobs(getWorkspaceExcludes(cwd)))
        ),
        ...getGlobMatchOptions(),
        // Relative matching keeps excludes such as **/out/** from matching
        // folders above the workspace root.
        absolute: false,
        followSymlinkedDirectories: followSymlinks,
      };
      const patterns = followSymlinks
        ? include
        : include.filter((pattern) => {
            if (pattern.startsWith('!')) return true;
            // A literal prefix is the walker's starting directory and
            // otherwise skips its normal symlink descent checks.
            return fastGlob
              .generateTasks([pattern], options)
              .every((task: { base: string }) =>
                isAllowedFilePath(path.resolve(cwd, task.base), [cwd], false)
              );
          });
      // One walk for every pattern. globby 8 walked the tree once per pattern.
      const files: string[] = await fastGlob(patterns, options);

      return files.map((filePath) => path.resolve(cwd, filePath));
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
