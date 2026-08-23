/* IMPORT */

import * as _ from 'lodash';
import * as querystring from 'querystring';
import * as path from 'path';
import * as vscode from 'vscode';
import stringMatches from 'string-matches';
import Config from '../../../config';
import EmbeddedView from '../../../views/embedded';
import Folder from '../../folder';
import Consts from '../../../consts';
import { hasConditionalExcludeGlobs, isFileIncluded } from '../../file-globs';
import { getWorkspaceExcludeRules } from '../../workspace-excludes';
import { getFollowingContext } from '../context';
import { updateEmbeddedDocumentCache } from '../document-cache';
import { matchesEmbeddedFilter } from '../filter';
import { splitLines } from '../../line-splitting';
import { parseEmbeddedMatches } from '../regex';

/* ABSTRACT */

class Abstract {
    disposed = false;
    include = undefined;
    exclude = undefined;
    rootPaths = undefined;
    configSignature = undefined;
    dataRefreshQueue: Promise<any> = Promise.resolve();
    fileDataRevisions: { [filePath: string]: number } = {};
    filesData = undefined; // { [filePath]: todo[] | undefined }
    nonEmptyFiles: Set<string> = new Set(); // Tracks only files with at least one embedded todo
    watchers: vscode.FileSystemWatcher[] = [];
    onDidChangeDataEvent = new vscode.EventEmitter<string | undefined>();
    onDidChangeData = this.onDidChangeDataEvent.event;

    async get(
        rootPaths = Folder.getAllRootPaths(),
        groupByRoot = true,
        groupByType = true,
        groupByFile = true,
        filter: string | false = false,
        onlyActiveFile: boolean = false
    ) {
        if (this.disposed) return;

        rootPaths = _.castArray(rootPaths);

        const config = Config.get();

        this.include = config.embedded.include;
        this.exclude = config.embedded.exclude;

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
            this.nonEmptyFiles = new Set();
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: 'Todo: Scanning embedded todos…',
                },
                async (progress) => {
                    await this.initFilesData(rootPaths, progress);
                }
            );

            if (this.disposed) return;

            this.configSignature = configSignature;
            this.watchPaths();
        } else {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: 'Todo: Updating embedded todos…',
                },
                async (progress) => {
                    await this.updateFilesData(progress);
                }
            );

            if (this.disposed) return;
        }

        return this.getTodos(groupByRoot, groupByType, groupByFile, filter, onlyActiveFile);
    }

    async watchPaths() {
        /* HELPERS */

        const pathNormalizer = (filePath) => filePath.replace(/\\/g, '/');

        /* HANDLERS */

        const refreshAll = _.debounce(() => EmbeddedView.refresh(), 250);
        const rescan = _.debounce(() => {
            this.dataRefreshQueue = this.dataRefreshQueue.then(() => {
                if (this.disposed) return;

                this.configSignature = undefined;
                this.onDidChangeDataEvent.fire(undefined);
                EmbeddedView.refresh();
            });
        }, 250);
        const queueFileChange = (filePath: string, update: boolean) => {
            const revision = (this.fileDataRevisions[filePath] || 0) + 1;

            this.fileDataRevisions[filePath] = revision;
            this.dataRefreshQueue = this.dataRefreshQueue
                .then(async () => {
                    if (
                        this.disposed ||
                        !this.filesData ||
                        revision !== this.fileDataRevisions[filePath]
                    )
                        return;

                    if (update) {
                        this.filesData[filePath] = undefined;
                        await this.updateFilesData();
                    } else {
                        delete this.filesData[filePath];
                        this.nonEmptyFiles.delete(filePath);
                    }

                    if (this.disposed || revision !== this.fileDataRevisions[filePath]) return;

                    this.onDidChangeDataEvent.fire(filePath);

                    if (update && typeof EmbeddedView.refreshFile === 'function') {
                        EmbeddedView.refreshFile(filePath);
                    } else {
                        refreshAll();
                    }
                })
                .catch((error) => {
                    if (!this.disposed) refreshAll();
                });
        };

        const add = (event) => {
            if (!this.filesData) return;
            const filePath = pathNormalizer(event.fsPath);
            if (!this.isIncluded(filePath)) return;
            queueFileChange(filePath, true);
        };

        const change = (event) => {
            if (!this.filesData) return;
            const filePath = pathNormalizer(event.fsPath);
            if (!this.isIncluded(filePath)) {
                queueFileChange(filePath, false);
                return;
            }
            // Targeted refresh: update only the file node if it's visible; this avoids a full tree rebuild
            queueFileChange(filePath, true);
        };

        const unlink = (event) => {
            if (!this.filesData) return;
            const filePath = pathNormalizer(event.fsPath);
            queueFileChange(filePath, false);
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

    dispose() {
        this.disposed = true;
        this.unwatchPaths();
        this.onDidChangeDataEvent.dispose();
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

    getCachedFilePath(filePath: string) {
        if (!this.filesData) return filePath;

        const normalized = path.normalize(filePath);

        return (
            Object.keys(this.filesData).find((key) => path.normalize(key) === normalized) ||
            filePath
        );
    }

    parseContent(filePath: string, content: string) {
        const data = [],
            lines = splitLines(content);

        if (!content) return data;

        let parsedPath;

        lines.forEach((rawLine, lineNr) => {
            const line = _.trimStart(rawLine),
                matches = parseEmbeddedMatches(line, Consts.regexes.todoEmbedded);

            if (!matches.length) return;

            if (!parsedPath) {
                parsedPath = Folder.parsePath(filePath);
            }

            matches.forEach((match) => {
                data.push({
                    ...match,
                    column: rawLine.length - line.length + match.column,
                    rawLine,
                    line,
                    lineNr,
                    context: this.getFollowingContext(lines, lineNr),
                    filePath,
                    root: parsedPath.root,
                    rootPath: parsedPath.rootPath,
                    relativePath: parsedPath.relativePath,
                });
            });
        });

        return data;
    }

    getFollowingContext(lines: string[], lineNr: number) {
        if (!Config.getKey('embedded.view.showContext')) return;

        return getFollowingContext(lines, lineNr, (line) => {
            return !!stringMatches(_.trimStart(line), Consts.regexes.todoEmbedded).length;
        });
    }

    updateDocumentData(textDocument: vscode.TextDocument) {
        if (!this.filesData || textDocument.uri.scheme !== 'file') return;

        const filePath = textDocument.uri.fsPath.replace(/\\/g, '/');

        if (!this.isIncluded(filePath)) return;

        const cachedFilePath = this.getCachedFilePath(filePath),
            data = this.parseContent(cachedFilePath, textDocument.getText());

        if (!updateEmbeddedDocumentCache(this.filesData, this.nonEmptyFiles, cachedFilePath, data))
            return;

        this.onDidChangeDataEvent.fire(cachedFilePath);

        return cachedFilePath;
    }

    async initFilesData(
        rootPaths,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ) {
        this.filesData = {};
    }

    async updateFilesData(progress?: vscode.Progress<{ message?: string; increment?: number }>) {}

    getTodos(groupByRoot, groupByType, groupByFile, filter, onlyActiveFile) {
        if (_.isEmpty(this.filesData)) return;

        const todos = {}, // { [ROOT] { [TYPE] => { [FILEPATH] => [DATA] } } }
            filterRe = filter ? new RegExp(_.escapeRegExp(filter), 'i') : false,
            filePaths = Array.from(this.nonEmptyFiles),
            activeFilePath = vscode.window.activeTextEditor
                ? vscode.window.activeTextEditor.document.uri.fsPath
                : '';

        // Note: Comment visibility is controlled in the Files view only. Embedded items are always TODO-like.

        filePaths.forEach((filePath) => {
            if (onlyActiveFile && path.normalize(filePath) !== path.normalize(activeFilePath))
                return;

            const data = this.filesData[filePath];

            if (!data || !data.length) return;

            const filePathGroup = groupByFile ? filePath : '';

            data.forEach((datum) => {
                if (!matchesEmbeddedFilter(filterRe, filePath, datum.line, datum.context)) return;

                const rootGroup = groupByRoot ? datum.root : '';

                if (!todos[rootGroup]) todos[rootGroup] = {};

                const typeGroup = groupByType ? datum.type : '';

                if (!todos[rootGroup][typeGroup]) todos[rootGroup][typeGroup] = {};

                if (!todos[rootGroup][typeGroup][filePathGroup])
                    todos[rootGroup][typeGroup][filePathGroup] = [];

                todos[rootGroup][typeGroup][filePathGroup].push(datum);
            });
        });

        const roots = Object.keys(todos);

        return roots.length > 1 ? todos : { '': todos[roots[0]] };
    }

    renderTodos(todos) {
        if (_.isEmpty(todos)) return '';

        const sepRe = new RegExp(querystring.escape('/'), 'g'),
            config = Config.get(),
            {
                indentation,
                embedded: {
                    file: { wholeLine },
                },
                symbols: { box },
            } = config,
            lines = [];

        /* LINES */

        const roots = Object.keys(todos).sort();

        roots.forEach((root) => {
            if (root) {
                lines.push(`\n${root}:`);
            }

            const types = Object.keys(todos[root]).sort();

            types.forEach((type) => {
                if (type) {
                    lines.push(`${root ? indentation : '\n'}${type}:`);
                }

                const filePaths = Object.keys(todos[root][type]).sort();

                filePaths.forEach((filePath) => {
                    if (filePath) {
                        const normalizedFilePath = `/${_.trimStart(filePath, '/')}`,
                            encodedFilePath = querystring
                                .escape(normalizedFilePath)
                                .replace(sepRe, '/');

                        lines.push(
                            `${root ? indentation : ''}${type ? indentation : ''}@file://${encodedFilePath}`
                        );
                    }

                    const data = todos[root][type][filePath];

                    data.forEach((datum) => {
                        const normalizedFilePath = `/${_.trimStart(datum.filePath, '/')}`,
                            encodedFilePath = querystring
                                .escape(normalizedFilePath)
                                .replace(sepRe, '/');

                        lines.push(
                            `${root ? indentation : ''}${type ? indentation : ''}${filePath ? indentation : ''}${box} ${_.trimStart(wholeLine ? datum.line : datum.message)} @file://${encodedFilePath}#${datum.lineNr + 1}`
                        );
                    });
                });
            });
        });

        return lines.length ? `${lines.join('\n')}\n` : '';
    }
}

/* EXPORT */

export default Abstract;
