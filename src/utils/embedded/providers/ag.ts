/* IMPORT */

import * as _ from 'lodash';
import * as execa from 'execa';
import Config from '../../../config';
import Consts from '../../../consts';
import Ackmate from '../../ackmate';
import File from '../../file';
import Folder from '../../folder';
import { getWorkspaceExcludeRules } from '../../workspace-excludes';
import { discoverFiles } from '../../file-discovery';
import { getBatchSize } from '../../batch-size';
import { getSearchFileBatches } from '../search-batches';
import { splitLines } from '../../line-splitting';
import { parseEmbeddedMatches } from '../regex';
import Abstract from './abstract';

/* AG */ // The Silver Searcher //URL: https://github.com/ggreer/the_silver_searcher

class AG extends Abstract {
  static bin = 'ag';

  async getFilePaths(rootPaths) {
    return discoverFiles(
      rootPaths,
      this.include || [],
      this.exclude || [],
      !!Config.getKey('followSymlinks'),
      getWorkspaceExcludeRules
    );
  }

  execa(filePaths) {
    const config = Config.get();

    return execa(AG.bin, [
      ...config.embedded.providers.ag.args,
      '--ackmate',
      '--nobreak',
      '--nocolor',
      '--heading',
      '--print-long-lines',
      '--silent',
      '--',
      config.embedded.providers.ag.regex,
      ...filePaths,
    ]);
  }

  async getAckmate(filePaths) {
    filePaths = _.castArray(filePaths);

    if (!filePaths.length) return [];

    const matches = [];
    const batchSize = getBatchSize(Config.get().embedded.batchSize);

    for (const batch of getSearchFileBatches(filePaths, batchSize)) {
      if (this.disposed) break;

      try {
        const { stdout } = await this.execa(batch);
        matches.push(...Ackmate.parse(stdout));
      } catch (error) {
        // Search tools exit with 1 when there are no matches. An unreadable
        // file can also produce a nonzero exit alongside valid results.
        if (error.stdout) matches.push(...Ackmate.parse(error.stdout));
        if (error.code !== 1) console.warn('Todo+: Embedded search failed', error);
      }
    }

    return matches;
  }

  filterAckmate(ackmate) {
    const filePaths = _.uniq(ackmate.map((obj) => obj.filePath)),
      includedFilePaths = this.getIncluded(filePaths);

    return ackmate.filter((obj) => includedFilePaths.includes(obj.filePath));
  }

  async ackmate2data(ackmate) {
    const contextLines = {};

    if (Config.getKey('embedded.view.showContext')) {
      await Promise.all(
        Array.from(new Set(ackmate.map((obj) => obj.filePath))).map(async (filePath: string) => {
          const content = await File.read(filePath);

          if (content !== undefined) {
            contextLines[filePath] = splitLines(content);
          }
        })
      );
    }

    ackmate.forEach(({ filePath, line: rawLine, lineNr }) => {
      const line = _.trimStart(rawLine),
        matches = parseEmbeddedMatches(line, Consts.regexes.todoEmbedded);

      if (!matches.length) return;

      const parsedPath = Folder.parsePath(filePath);

      matches.forEach((match) => {
        const data = {
          ...match,
          column: rawLine.length - line.length + match.column,
          rawLine,
          line,
          lineNr,
          context: contextLines[filePath]
            ? this.getFollowingContext(contextLines[filePath], lineNr)
            : undefined,
          filePath,
          root: parsedPath.root,
          rootPath: parsedPath.rootPath,
          relativePath: parsedPath.relativePath,
        };

        if (!this.filesData[filePath]) this.filesData[filePath] = [];

        this.filesData[filePath].push(data);
      });
    });
  }

  async initFilesData(rootPaths) {
    // Limit the initial external search to the include globs to avoid scanning the whole workspace.
    // This mirrors the JS provider behavior and massively reduces unnecessary IO when includes are narrow (e.g. only **/*.md).
    const filePaths = await this.getFilePaths(rootPaths);
    const ackmate = this.filterAckmate(await this.getAckmate(filePaths));

    this.filesData = {};

    await this.ackmate2data(ackmate);

    // Update non-empty set to only include files that actually have todos
    this.nonEmptyFiles = new Set(Object.keys(this.filesData));
    this.applyOpenDocumentData(filePaths);
  }

  async updateFilesData() {
    const pending = Object.keys(this.filesData).filter((filePath) => !this.filesData[filePath]);
    if (!pending.length) return;

    const ackmate = await this.getAckmate(pending);

    await this.ackmate2data(ackmate);

    // Prune files that still have no results
    this.filesData = _.transform(
      this.filesData,
      (acc, val, key) => {
        if (!val) return;
        acc[key] = val;
      },
      {}
    );

    // Update non-empty set based on the pending files processed
    for (const fp of pending) {
      if (this.filesData[fp] && this.filesData[fp].length) {
        this.nonEmptyFiles.add(fp);
      } else {
        this.nonEmptyFiles.delete(fp);
      }
    }
    this.applyOpenDocumentData(pending);
  }
}

/* EXPORT */

export default AG;
