/* IMPORT */

import * as _ from 'lodash';
import * as querystring from 'querystring';
import * as vscode from 'vscode';
import Config from '../../../config';
import EmbeddedView from '../../../views/embedded';
import Folder from '../../folder';
import Consts from '../../../consts';
import { getFilePathKey, hasConditionalExcludeGlobs, isFileIncluded } from '../../file-globs';
import { getWorkspaceExcludeRules } from '../../workspace-excludes';
import { getFollowingContext } from '../context';
import { updateEmbeddedDocumentCache } from '../document-cache';
import { matchesEmbeddedFilter } from '../filter';
import { splitLines } from '../../line-splitting';
import { isLiquidFilePath, parseLiquidBlockCommentMatches } from '../liquid-comments';
import { parseEmbeddedMatches } from '../regex';
import { isAllowedFilePath } from '../../file-discovery';
import { createWorkspacePathResolver } from '../../workspace-paths';

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
  private watcherCleanup: (() => void)[] = [];
  protected watcherGeneration = 0;
  private workspacePaths: ReturnType<typeof createWorkspacePathResolver>;
  private workspaceInvalidated = false;
  private indexedFilesData;
  private cachedFilePaths = new Map<string, string>();
  onDidChangeDataEvent = new vscode.EventEmitter<string | undefined>();
  onDidChangeData = this.onDidChangeDataEvent.event;

  get(
    rootPaths = Folder.getAllRootPaths(),
    groupByRoot = true,
    groupByType = true,
    groupByFile = true,
    filter: string | false = false,
    onlyActiveFile = false
  ) {
    const next = this.dataRefreshQueue.then(() =>
      this.getNow(rootPaths, groupByRoot, groupByType, groupByFile, filter, onlyActiveFile)
    );
    this.dataRefreshQueue = next.catch(() => undefined);
    return next;
  }

  private async getNow(
    rootPaths = Folder.getAllRootPaths(),
    groupByRoot = true,
    groupByType = true,
    groupByFile = true,
    filter: string | false = false,
    onlyActiveFile: boolean = false
  ) {
    if (this.disposed) return;

    rootPaths = _.castArray(rootPaths);

    if (this.workspacePaths && _.isEqual(this.workspacePaths.rootPaths, rootPaths)) {
      this.refreshWorkspacePaths();
    }

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
      this.workspaceInvalidated = false;
      this.getWorkspacePaths();
      const generation = this.watcherGeneration;
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

      if (this.disposed || generation !== this.watcherGeneration) return;

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

    if (this.refreshWorkspacePaths()) return;

    return this.getTodos(groupByRoot, groupByType, groupByFile, filter, onlyActiveFile);
  }

  async watchPaths() {
    const generation = this.watcherGeneration;
    /* HELPERS */

    const pathNormalizer = (filePath) => this.getCachedFilePath(filePath);

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
    this.watcherCleanup.push(
      () => refreshAll.cancel(),
      () => rescan.cancel()
    );
    const queueFileChange = (filePath: string, update: boolean) => {
      const revision = (this.fileDataRevisions[filePath] || 0) + 1;

      this.fileDataRevisions[filePath] = revision;
      this.dataRefreshQueue = this.dataRefreshQueue
        .then(async () => {
          if (
            this.disposed ||
            generation !== this.watcherGeneration ||
            !this.filesData ||
            revision !== this.fileDataRevisions[filePath]
          )
            return;

          if (update) {
            this.setFileData(filePath, undefined);
            await this.updateFilesData();
          } else {
            this.deleteFileData(filePath);
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
      if (
        this.disposed ||
        !this.filesData ||
        this.refreshWorkspacePaths() ||
        this.workspaceInvalidated
      )
        return;
      const filePath = pathNormalizer(event.fsPath);
      if (!this.isIncluded(filePath)) return;
      queueFileChange(filePath, true);
    };

    const change = (event) => {
      if (
        this.disposed ||
        !this.filesData ||
        this.refreshWorkspacePaths() ||
        this.workspaceInvalidated
      )
        return;
      const filePath = pathNormalizer(event.fsPath);
      if (!this.isIncluded(filePath)) {
        queueFileChange(filePath, false);
        return;
      }
      // Targeted refresh: update only the file node if it's visible; this avoids a full tree rebuild
      queueFileChange(filePath, true);
    };

    const unlink = (event) => {
      if (
        this.disposed ||
        !this.filesData ||
        this.refreshWorkspacePaths() ||
        this.workspaceInvalidated
      )
        return;
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
    this.watcherGeneration += 1;
    this.configSignature = undefined;
    this.workspacePaths = undefined;
    this.watcherCleanup.forEach((cleanup) => cleanup());
    this.watcherCleanup = [];
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];
  }

  dispose() {
    this.disposed = true;
    this.unwatchPaths();
    this.onDidChangeDataEvent.dispose();
  }

  getIncluded(filePaths) {
    return filePaths.filter(
      (filePath) =>
        isAllowedFilePath(
          filePath,
          this.rootPaths || Folder.getAllRootPaths(),
          !!Config.getKey('followSymlinks')
        ) &&
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
    const paths = this.getWorkspacePaths();
    if (this.indexedFilesData !== this.filesData) {
      this.cachedFilePaths.clear();
      Object.keys(this.filesData || {}).forEach((cached) =>
        this.cachedFilePaths.set(getFilePathKey(cached), cached)
      );
      this.indexedFilesData = this.filesData;
    }

    const candidates = paths.getWorkspacePaths(filePath);
    const cached = [filePath, ...candidates]
      .map((candidate) => this.cachedFilePaths.get(getFilePathKey(candidate)))
      .find((candidate) => candidate !== undefined);

    return cached || candidates.find((candidate) => this.isIncluded(candidate)) || filePath;
  }

  protected setFileData(filePath: string, data) {
    this.filesData[filePath] = data;
    if (this.indexedFilesData === this.filesData) {
      this.cachedFilePaths.set(getFilePathKey(filePath), filePath);
    }
  }

  protected deleteFileData(filePath: string) {
    delete this.filesData[filePath];
    if (this.indexedFilesData === this.filesData) {
      this.cachedFilePaths.delete(getFilePathKey(filePath));
    }
  }

  protected updateDocumentCache(filePath: string, data: any[]): boolean {
    const changed = updateEmbeddedDocumentCache(this.filesData, this.nonEmptyFiles, filePath, data);
    if (changed && this.indexedFilesData === this.filesData) {
      if (data.length) this.cachedFilePaths.set(getFilePathKey(filePath), filePath);
      else this.cachedFilePaths.delete(getFilePathKey(filePath));
    }
    return changed;
  }

  private refreshWorkspacePaths(): boolean {
    if (!this.workspacePaths || !this.workspacePaths.refresh()) return false;

    this.workspaceInvalidated = true;
    this.unwatchPaths();
    this.filesData = {};
    this.nonEmptyFiles.clear();
    this.onDidChangeDataEvent.fire(undefined);
    EmbeddedView.refresh();
    return true;
  }

  private getWorkspacePaths() {
    const rootPaths = this.rootPaths || Folder.getAllRootPaths();

    if (!this.workspacePaths || !_.isEqual(this.workspacePaths.rootPaths, rootPaths)) {
      this.workspacePaths = createWorkspacePathResolver(rootPaths);
    }

    return this.workspacePaths;
  }

  parseContent(filePath: string, content: string) {
    const data = [],
      lines = splitLines(content),
      liquidMatches = isLiquidFilePath(filePath)
        ? parseLiquidBlockCommentMatches(lines, Consts.regexes.todoEmbedded)
        : [],
      liquidMatchLines = new Set(liquidMatches.map((match) => match.lineNr)),
      liquidMatchesByLine = new Map<number, typeof liquidMatches>();

    liquidMatches.forEach((match) => {
      const matches = liquidMatchesByLine.get(match.lineNr) || [];
      matches.push(match);
      liquidMatchesByLine.set(match.lineNr, matches);
    });

    if (!content) return data;

    let parsedPath;

    lines.forEach((rawLine, lineNr) => {
      const line = _.trimStart(rawLine),
        ordinaryMatches = parseEmbeddedMatches(line, Consts.regexes.todoEmbedded).map((match) => ({
          ...match,
          column: rawLine.length - line.length + match.column,
        })),
        matches = ordinaryMatches
          .concat(
            (liquidMatchesByLine.get(lineNr) || []).filter(
              (match) =>
                !ordinaryMatches.some(
                  (ordinary) =>
                    ordinary.column <= match.column &&
                    ordinary.column + ordinary.todo.length > match.column
                )
            )
          )
          .sort((a, b) => a.column - b.column);

      if (!matches.length) return;

      if (!parsedPath) {
        parsedPath = Folder.parsePath(filePath);
      }

      matches.forEach((match) => {
        data.push({
          ...match,
          rawLine,
          line,
          lineNr,
          context: this.getFollowingContext(lines, lineNr, liquidMatchLines),
          filePath,
          root: parsedPath.root,
          rootPath: parsedPath.rootPath,
          relativePath: parsedPath.relativePath,
        });
      });
    });

    return data;
  }

  getFollowingContext(lines: string[], lineNr: number, extraTodoLines?: Set<number>) {
    if (!Config.getKey('embedded.view.showContext')) return;

    return getFollowingContext(lines, lineNr, (line) => {
      return (
        (!!extraTodoLines && extraTodoLines.has(lineNr + 1)) ||
        !!parseEmbeddedMatches(_.trimStart(line), Consts.regexes.todoEmbedded).length
      );
    });
  }

  updateDocumentData(textDocument: vscode.TextDocument) {
    if (
      this.disposed ||
      !this.filesData ||
      textDocument.uri.scheme !== 'file' ||
      this.refreshWorkspacePaths() ||
      this.workspaceInvalidated
    )
      return;

    const filePath = this.getCachedFilePath(textDocument.uri.fsPath);

    if (!this.isIncluded(filePath)) return;

    const data = this.parseContent(filePath, textDocument.getText());

    this.fileDataRevisions[filePath] = (this.fileDataRevisions[filePath] || 0) + 1;

    if (!this.updateDocumentCache(filePath, data)) return;

    this.onDidChangeDataEvent.fire(filePath);

    return filePath;
  }

  protected getOpenDocument(filePath: string) {
    const paths = this.getWorkspacePaths();
    const key = paths.getKey(filePath);
    return vscode.workspace.textDocuments.find(
      (document) => document.uri.scheme === 'file' && paths.getKey(document.uri.fsPath) === key
    );
  }

  protected applyOpenDocumentData(filePaths: string[]) {
    filePaths.forEach((filePath) => {
      const document = this.getOpenDocument(filePath);
      if (!document) return;
      this.updateDocumentCache(filePath, this.parseContent(filePath, document.getText()));
    });
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

    const todos = Object.create(null), // { [ROOT] { [TYPE] => { [FILEPATH] => [DATA] } } }
      filterRe = filter ? new RegExp(_.escapeRegExp(filter), 'i') : false,
      filePaths = Array.from(this.nonEmptyFiles),
      activeFilePath = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.document.uri.fsPath
        : '',
      paths = onlyActiveFile ? this.getWorkspacePaths() : undefined;

    // Note: Comment visibility is controlled in the Files view only. Embedded items are always TODO-like.

    filePaths.forEach((filePath) => {
      if (onlyActiveFile && paths.getKey(filePath) !== paths.getKey(activeFilePath)) return;

      const data = this.filesData[filePath];

      if (!data || !data.length) return;

      const filePathGroup = groupByFile ? filePath : '';

      data.forEach((datum) => {
        if (!matchesEmbeddedFilter(filterRe, filePath, datum.line, datum.context)) return;

        const rootGroup = groupByRoot ? datum.root : '';

        if (!todos[rootGroup]) todos[rootGroup] = Object.create(null);

        const typeGroup = groupByType ? datum.type : '';

        if (!todos[rootGroup][typeGroup]) todos[rootGroup][typeGroup] = Object.create(null);

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
              encodedFilePath = querystring.escape(normalizedFilePath).replace(sepRe, '/');

            lines.push(
              `${root ? indentation : ''}${type ? indentation : ''}@file://${encodedFilePath}`
            );
          }

          const data = todos[root][type][filePath];

          data.forEach((datum) => {
            const normalizedFilePath = `/${_.trimStart(datum.filePath, '/')}`,
              encodedFilePath = querystring.escape(normalizedFilePath).replace(sepRe, '/');

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
