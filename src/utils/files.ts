/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as pify from 'pify';
import Config from '../config';
import FilesView from '../views/files';
import { Due } from '../views/due';
import { getGlobMatchOptions, hasConditionalExcludeGlobs, isFileIncluded } from './file-globs';
import Folder from './folder';
import { matchesFilesViewFilter } from './files-view-filter';
import { mapFulfilled } from './promises';
import { getWorkspaceExcludeGlobs, getWorkspaceExcludeRules } from './workspace-excludes';
import { getBatchSize } from './batch-size';
import { getUniqueRootKeys } from './file-groups';

/* FILES */

class Files {
    //FIXME: There's some code duplication between this and `embedded`

    include = undefined;
    exclude = undefined;
    rootPaths = undefined;
    configSignature = undefined;
    filesData = undefined; // { [filePath]: todo | undefined }
    watchers: vscode.FileSystemWatcher[] = [];

    async get(rootPaths = Folder.getAllRootPaths(), filter: string | false = false) {
        rootPaths = _.castArray(rootPaths);

        const config = Config.get();

        this.include = config.file.include;
        this.exclude = config.file.exclude;

        const configSignature = JSON.stringify({
            include: this.include,
            exclude: this.exclude,
            followSymlinks: !!config.followSymlinks,
            workspaceExclude: rootPaths.map((rootPath) => getWorkspaceExcludeRules(rootPath)),
        });

        if (
            !this.filesData ||
            !_.isEqual(this.rootPaths, rootPaths) ||
            this.configSignature !== configSignature
        ) {
            this.rootPaths = rootPaths;
            this.unwatchPaths();
            await this.initFilesData(rootPaths);
            this.configSignature = configSignature;
            this.watchPaths();
        } else {
            await this.updateFilesData();
        }

        this.updateContext();

        return this.getTodos(filter);
    }

    async watchPaths() {
        /* HELPERS */

        const pathNormalizer = (filePath) => filePath.replace(/\\/g, '/');

        /* HANDLERS */

        const refresh = _.debounce(() => {
            FilesView.refresh();
            Due.refresh();
        }, 250);
        const rescan = _.debounce(() => {
            this.configSignature = undefined;
            FilesView.refresh();
            Due.refresh();
        }, 250);

        const add = (event) => {
            console.log('add', event.fsPath);
            if (!this.filesData) return;
            const filePath = pathNormalizer(event.fsPath);
            if (this.filesData.hasOwnProperty(filePath)) return;
            if (!this.isIncluded(filePath)) return;
            this.filesData[filePath] = undefined;
            refresh();
        };

        const change = (event) => {
            console.log('change', event.fsPath);
            if (!this.filesData) return;
            const filePath = pathNormalizer(event.fsPath);
            if (!this.isIncluded(filePath)) {
                delete this.filesData[filePath];
                refresh();
                return;
            }
            this.filesData[filePath] = undefined;
            refresh();
        };

        const unlink = (event) => {
            console.log('unlink', event.fsPath);
            if (!this.filesData) return;
            const filePath = pathNormalizer(event.fsPath);
            delete this.filesData[filePath];
            refresh();
        };

        /* WATCHING */

        this.include.forEach((glob) => {
            const watcher = vscode.workspace.createFileSystemWatcher(glob);

            watcher.onDidCreate(add);
            watcher.onDidChange(change);
            watcher.onDidDelete(unlink);
            this.watchers.push(watcher);
        });

        if (
            this.rootPaths.some((rootPath) =>
                hasConditionalExcludeGlobs(getWorkspaceExcludeRules(rootPath))
            )
        ) {
            const watcher = vscode.workspace.createFileSystemWatcher('**/*');

            watcher.onDidCreate(rescan);
            watcher.onDidDelete(rescan);
            this.watchers.push(watcher);
        }
    }

    unwatchPaths() {
        this.watchers.forEach((watcher) => watcher.dispose());
        this.watchers = [];
    }

    getIncluded(filePaths) {
        return filePaths.filter((filePath) =>
            isFileIncluded(
                filePath,
                Folder.getRootPath(filePath),
                this.include,
                this.exclude || [],
                getWorkspaceExcludeRules(filePath)
            )
        );
    }

    isIncluded(filePath) {
        return !!this.getIncluded([filePath]).length;
    }

    async getFilePaths(rootPaths): Promise<string[]> {
        const globby = require('globby'); // Lazy import for performance

        const config = Config.get(),
            include = config.file.include || [],
            exclude = config.file.exclude || [],
            follow = !!Config.getKey('followSymlinks');

        const scans = await mapFulfilled<string, string[]>(
                rootPaths,
                (cwd) =>
                    globby(include, {
                        cwd,
                        ignore: exclude.concat(getWorkspaceExcludeGlobs(cwd)),
                        ...getGlobMatchOptions(),
                        absolute: true,
                        followSymbolicLinks: follow,
                    }),
                (cwd, error) => console.warn(`Todo+: Could not scan ${cwd}`, error)
            ),
            raw = ([] as string[]).concat(...scans);

        // Deduplicate by realpath to avoid cycles and duplicate targets (defensive)
        const seen = new Set<string>();
        const result: string[] = [];
        for (const fp of raw) {
            let rp: string;
            try {
                rp = await (pify(fs.realpath) as any)(fp);
            } catch (e) {
                rp = fp;
            }
            if (
                !seen.has(rp) &&
                isFileIncluded(
                    fp,
                    Folder.getRootPath(fp),
                    include,
                    exclude,
                    getWorkspaceExcludeRules(fp)
                )
            ) {
                seen.add(rp);
                result.push(fp);
            }
        }

        return result;
    }

    async initFilesData(rootPaths) {
        const filePaths = await this.getFilePaths(rootPaths);

        this.filesData = {};

        const BATCH_SIZE = getBatchSize(Config.get().file.batchSize);
        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
            const batch = filePaths.slice(i, i + BATCH_SIZE);
            await mapFulfilled(
                batch,
                async (filePath: string) => {
                    this.filesData[filePath] = await this.getFileData(filePath);
                },
                (filePath, error) => {
                    delete this.filesData[filePath];
                    console.warn(`Todo+: Could not open ${filePath}`, error);
                }
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    async updateFilesData() {
        if (_.isEmpty(this.filesData)) return;

        const pending = Object.keys(this.filesData).filter((filePath) => !this.filesData[filePath]);
        if (!pending.length) return;

        const BATCH_SIZE = getBatchSize(Config.get().file.batchSize);
        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
            const batch = pending.slice(i, i + BATCH_SIZE);
            await mapFulfilled(
                batch,
                async (filePath: string) => {
                    this.filesData[filePath] = await this.getFileData(filePath);
                },
                (filePath, error) => {
                    delete this.filesData[filePath];
                    console.warn(`Todo+: Could not open ${filePath}`, error);
                }
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    async getFileData(filePath) {
        const parsedPath = Folder.parsePath(filePath),
            textEditor = await vscode.workspace.openTextDocument(filePath);

        return {
            textEditor,
            filePath,
            root: parsedPath.root,
            rootPath: parsedPath.rootPath,
            relativePath: parsedPath.relativePath,
        };
    }

    getTodos(filter: string | false = false) {
        if (_.isEmpty(this.filesData)) return;

        const todos = {}, // { [ROOT] { { [FILEPATH] => [DATA] } }
            filePaths = Object.keys(this.filesData);
        const visibleFiles = filePaths
            .map((filePath) => ({ filePath, data: this.filesData[filePath] }))
            .filter(({ filePath, data }) => {
                if (!data) return false;
                return matchesFilesViewFilter(filter, filePath, [data.textEditor.getText()]);
            });
        const rootKeys = getUniqueRootKeys(
            visibleFiles.map(({ data }) => ({ root: data.root, rootPath: data.rootPath }))
        );

        visibleFiles.forEach(({ filePath, data }, index) => {
            const root = rootKeys[index];

            if (!todos[root]) todos[root] = {};

            todos[root][filePath] = data;
        });

        return this.simplifyTodos(todos);
    }

    simplifyTodos(obj) {
        if (_.isObject(obj)) {
            const keys = Object.keys(obj);

            if (keys.length === 1) {
                obj[''] = this.simplifyTodos(obj[keys[0]]);
            }
        }

        return obj;
    }

    updateContext() {
        const filesNr = Object.keys(this.filesData).length;

        vscode.commands.executeCommand('setContext', 'todo-files-open-button', filesNr <= 1);
    }
}

/* EXPORT */

export default new Files();
