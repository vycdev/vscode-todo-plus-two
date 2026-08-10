/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Config from '../../../config';
import Consts from '../../../consts';
import File from '../../file';
import { getGlobMatchOptions } from '../../file-globs';
import { getBatchSize } from '../../batch-size';
import { flatMapFulfilled } from '../../promises';
import { getWorkspaceExcludeGlobs } from '../../workspace-excludes';
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
        const globby = require('globby'); // Lazy import for performance

        const follow = !!Config.getKey('followSymlinks');

        const raw = await flatMapFulfilled<string, string>(
            rootPaths,
            (cwd) =>
                globby(this.include, {
                    cwd,
                    ignore: (this.exclude || []).concat(getWorkspaceExcludeGlobs(cwd)),
                    ...getGlobMatchOptions(),
                    absolute: true,
                    followSymbolicLinks: follow,
                }),
            (cwd, error) => console.warn(`Todo+: Could not scan ${cwd}`, error)
        );

        // Deduplicate by realpath (defensive)
        const fs = require('fs');
        const pify = require('pify');
        const seen = new Set();
        const result = [];
        for (const fp of raw) {
            let rp;
            try {
                rp = await pify(fs.realpath)(fp);
            } catch (e) {
                rp = fp;
            }
            if (!seen.has(rp) && this.isIncluded(fp)) {
                seen.add(rp);
                result.push(fp);
            }
        }

        return result;
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
                const data = await this.getFileData(filePath);
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
                const data = await this.getFileData(filePath);
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
        const openDoc = vscode.workspace.textDocuments.find(
            (d) => d.uri && d.uri.fsPath === filePath
        );
        const content = openDoc ? openDoc.getText() : await File.read(filePath);

        if (!content) return [];

        // Skip full parsing when no line matches the configured embedded regex.
        if (!hasEmbeddedMatch(content, Consts.regexes.todoEmbedded)) return [];

        return this.parseContent(filePath, content);
    }
}

/* EXPORT */

export default JS;
