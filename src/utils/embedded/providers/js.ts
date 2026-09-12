/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Config from '../../../config';
import Consts from '../../../consts';
import File from '../../file';
import { getBatchSize } from '../../batch-size';
import { getWorkspaceExcludeRules } from '../../workspace-excludes';
import { discoverFiles } from '../../file-discovery';
import { hasEmbeddedMatch } from '../regex';
import Abstract from './abstract';

/* JS */

class JS extends Abstract {
  /* PRIVATE HELPERS */

  private async forEachInBatches<T>(
    items: T[],
    batchSize: number,
    fn: (item: T) => Promise<any>,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    total?: number,
    doneRef?: { count: number }
  ) {
    for (let i = 0; i < items.length; i += batchSize) {
      if (this.disposed) return;
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map((it) => fn(it)));
      if (progress && total && doneRef) {
        doneRef.count += batch.length;
        const increment = (batch.length / total) * 100;
        progress.report({ message: `Scanning ${doneRef.count}/${total}`, increment });
      }
      // Yield to the event loop to keep the extension host responsive
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  async getFilePaths(rootPaths) {
    return discoverFiles(
      rootPaths,
      this.include || [],
      this.exclude || [],
      !!Config.getKey('followSymlinks'),
      getWorkspaceExcludeRules
    );
  }

  async initFilesData(
    rootPaths,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ) {
    const filePaths = await this.getFilePaths(rootPaths);

    this.filesData = {};

    const BATCH_SIZE = getBatchSize(Config.get().embedded.batchSize);
    const doneRef = { count: 0 };
    await this.forEachInBatches(
      filePaths,
      BATCH_SIZE,
      async (filePath: string) => {
        const revision = this.fileDataRevisions[filePath] || 0;
        const data = await this.getFileData(filePath);
        if (this.disposed || revision !== (this.fileDataRevisions[filePath] || 0)) return;
        if (data && data.length) {
          this.filesData[filePath] = data;
          this.nonEmptyFiles.add(filePath);
        } else {
          delete this.filesData[filePath];
          this.nonEmptyFiles.delete(filePath);
        }
      },
      progress,
      filePaths.length,
      doneRef
    );
  }

  async updateFilesData(progress?: vscode.Progress<{ message?: string; increment?: number }>) {
    if (_.isEmpty(this.filesData)) return;

    const pending = Object.keys(this.filesData).filter((fp) => !this.filesData[fp]);
    if (!pending.length) return;

    const BATCH_SIZE = getBatchSize(Config.get().embedded.batchSize);
    const doneRef = { count: 0 };
    await this.forEachInBatches(
      pending,
      BATCH_SIZE,
      async (filePath: string) => {
        const revision = this.fileDataRevisions[filePath] || 0;
        const data = await this.getFileData(filePath);
        if (this.disposed || revision !== (this.fileDataRevisions[filePath] || 0)) return;
        if (data && data.length) {
          this.filesData[filePath] = data;
          this.nonEmptyFiles.add(filePath);
        } else {
          delete this.filesData[filePath];
          this.nonEmptyFiles.delete(filePath);
        }
      },
      progress,
      pending.length,
      doneRef
    );
  }

  async getFileData(filePath) {
    const openDoc = this.getOpenDocument(filePath);
    const content = openDoc ? openDoc.getText() : await File.read(filePath);

    if (!content) return [];

    // Skip full parsing when no line matches the configured embedded regex.
    if (!hasEmbeddedMatch(content, Consts.regexes.todoEmbedded)) return [];

    return this.parseContent(filePath, content);
  }
}

/* EXPORT */

export default JS;
