/* IMPORT */

import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { TextDocument } from 'vscode';
import Config from '../config';
import FilesView from '../views/files';
import { Due } from '../views/due';
import { getFilePathKey, hasConditionalExcludeGlobs } from './file-globs';
import Folder from './folder';
import { matchesFilesViewFilter } from './files-view-filter';
import { mapFulfilled } from './promises';
import { getWorkspaceExcludeRules } from './workspace-excludes';
import { getBatchSize } from './batch-size';
import { getUniqueRootKeys } from './file-groups';
import { isAllowedFilePath } from './file-discovery';
import {
  getTaskFileIncludes,
  getMarkdownTaskNodes,
  getMarkdownTaskSettings,
  isMarkdownTaskDocument,
} from './task-source';
import { discoverTodoFiles, getAbsoluteFilePaths, isTodoFileIncluded } from './todo-file-discovery';

/* FILES */

class Files {
  //FIXME: There's some code duplication between this and `embedded`

  include = undefined;
  exclude = undefined;
  rootPaths = undefined;
  configSignature = undefined;
  filesData = undefined; // { [filePath]: todo | undefined }
  watchers: vscode.FileSystemWatcher[] = [];
  private watcherCleanup: (() => void)[] = [];
  private watcherGeneration = 0;
  private disposed = false;
  private dataRefreshQueue: Promise<any> = Promise.resolve();
  private fileDataRevisions: { [filePath: string]: number } = {};

  get(rootPaths = Folder.getAllRootPaths(), filter: string | false = false) {
    return this.enqueue(() => this.getNow(rootPaths, filter));
  }

  // Discovered task documents, sharing discovery, watchers, and loaded buffers
  // with the views. Callers must not reopen every file: VS Code keeps only a few
  // extension-opened documents alive and closes the rest, firing close events.
  getDocuments(
    rootPaths = Folder.getAllRootPaths()
  ): Promise<{ [filePath: string]: TextDocument }> {
    return this.enqueue(async () => {
      const documents: { [filePath: string]: TextDocument } = Object.create(null);

      if (!(await this.sync(rootPaths))) return documents;

      Object.keys(this.filesData).forEach((filePath) => {
        const data = this.filesData[filePath];
        if (data && data.textEditor) documents[filePath] = data.textEditor;
      });

      return documents;
    });
  }

  // A closed buffer keeps its last text. Reload it from disk when that text
  // included unsaved edits that may have been discarded.
  invalidateDocument(document: TextDocument) {
    if (!this.filesData || !document.uri || document.uri.scheme !== 'file') return;

    const filePath = document.uri.fsPath.replace(/\\/g, '/'),
      data = this.filesData[filePath];

    if (!data || data.textEditor !== document) return;

    this.fileDataRevisions[filePath] = (this.fileDataRevisions[filePath] || 0) + 1;
    this.filesData[filePath] = undefined;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.dataRefreshQueue.then(task);
    this.dataRefreshQueue = next.catch(() => undefined);
    return next;
  }

  private async getNow(rootPaths = Folder.getAllRootPaths(), filter: string | false = false) {
    if (!(await this.sync(rootPaths))) return;

    this.updateContext();

    return this.getTodos(filter);
  }

  private async sync(rootPaths = Folder.getAllRootPaths()): Promise<boolean> {
    if (this.disposed) return false;

    rootPaths = _.castArray(rootPaths);

    const config = Config.get();

    this.include = getTaskFileIncludes(config);
    this.exclude = config.file.exclude;

    const configSignature = JSON.stringify({
      include: this.include,
      exclude: this.exclude,
      followSymlinks: !!config.followSymlinks,
      markdown: config.markdown,
      workspaceExclude: rootPaths.map((rootPath) => getWorkspaceExcludeRules(rootPath)),
    });

    if (
      !this.filesData ||
      !_.isEqual(this.rootPaths, rootPaths) ||
      this.configSignature !== configSignature
    ) {
      this.rootPaths = rootPaths;
      this.unwatchPaths();
      const generation = this.watcherGeneration;
      await this.initFilesData(rootPaths);
      if (this.disposed || generation !== this.watcherGeneration) return false;
      this.configSignature = configSignature;
      this.watchPaths();
    } else {
      await this.updateFilesData();
    }

    return !this.disposed;
  }

  async watchPaths() {
    /* HELPERS */

    const pathNormalizer = (filePath) => filePath.replace(/\\/g, '/');
    const absolutePaths = getAbsoluteFilePaths(this.include);

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

    this.watcherCleanup.push(
      () => refresh.cancel(),
      () => rescan.cancel()
    );
    const invalidate = (filePath: string) => {
      this.fileDataRevisions[filePath] = (this.fileDataRevisions[filePath] || 0) + 1;
    };

    const add = (event) => {
      if (!this.filesData) return;
      const filePath = pathNormalizer(event.fsPath);
      if (this.filesData.hasOwnProperty(filePath)) return;
      if (!this.isIncluded(filePath)) return;
      // A new workspace path may alias an explicit file already in the cache.
      if (absolutePaths.length) return rescan();
      invalidate(filePath);
      this.filesData[filePath] = undefined;
      refresh();
    };

    const change = (event) => {
      if (!this.filesData) return;
      const filePath = pathNormalizer(event.fsPath);
      const cached = this.filesData.hasOwnProperty(filePath);
      if (!this.isIncluded(filePath)) {
        invalidate(filePath);
        delete this.filesData[filePath];
        if (absolutePaths.length && cached) rescan();
        else refresh();
        return;
      }
      // A followed alias may now refer to a different explicit file. Ordinary
      // cached workspace files can still use the cheaper incremental update.
      if (
        absolutePaths.length &&
        (!cached ||
          (Config.get().followSymlinks && !isAllowedFilePath(filePath, this.rootPaths, false)))
      )
        return rescan();
      invalidate(filePath);
      this.filesData[filePath] = undefined;
      refresh();
    };

    const unlink = (event) => {
      if (!this.filesData) return;
      const filePath = pathNormalizer(event.fsPath);
      const cached = this.filesData.hasOwnProperty(filePath);
      invalidate(filePath);
      delete this.filesData[filePath];
      // Discovery may have picked this workspace alias instead of the explicit
      // path. Find a remaining path to the same file before rebuilding the tree.
      if (absolutePaths.length && cached) rescan();
      else refresh();
    };

    /* WATCHING */

    this.include
      .filter((entry) => !path.isAbsolute(entry))
      .forEach((glob) => {
        const watcher = vscode.workspace.createFileSystemWatcher(glob);

        watcher.onDidCreate(add);
        watcher.onDidChange(change);
        watcher.onDidDelete(unlink);
        this.watchers.push(watcher);
      });

    // VS Code 1.36 only watches workspace files. Poll explicitly configured
    // files as well, including missing files so deletion/recreation is detected.
    const pollPaths = new Map<string, string>();
    const poll = (filePath: string) => pollPaths.set(getFilePathKey(filePath), filePath);
    absolutePaths.forEach((filePath) => {
      poll(filePath);
      const basename = path.basename(filePath, path.extname(filePath));
      const excludes = getWorkspaceExcludeRules(filePath);
      Object.keys(excludes).forEach((glob) => {
        const rule = excludes[glob];
        if (rule && typeof rule !== 'boolean' && typeof rule.when === 'string') {
          poll(
            path.resolve(path.dirname(filePath), rule.when.replace(/\$\(basename\)/g, basename))
          );
        }
      });
    });
    const generation = this.watcherGeneration;
    pollPaths.forEach((filePath) => {
      const listener = (current: fs.Stats, previous: fs.Stats) => {
        if (this.disposed || generation !== this.watcherGeneration) return;
        // watchFile initially reports zero stats for a missing file. Rescanning
        // that event would recreate the watcher and repeat it indefinitely.
        if (!current.nlink && !previous.nlink) return;
        // Rescan to preserve realpath deduplication when an explicit file also
        // appears through a workspace glob or a symlink.
        rescan();
      };
      fs.watchFile(filePath, { persistent: false, interval: 1000 }, listener);
      this.watcherCleanup.push(() => fs.unwatchFile(filePath, listener));
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
    this.watcherCleanup.forEach((cleanup) => cleanup());
    this.watcherCleanup = [];
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];
  }

  dispose() {
    this.disposed = true;
    this.unwatchPaths();
  }

  getIncluded(filePaths) {
    return filePaths.filter((filePath) =>
      isTodoFileIncluded(
        filePath,
        this.rootPaths || Folder.getAllRootPaths(),
        this.include || [],
        this.exclude || [],
        !!Config.getKey('followSymlinks'),
        getWorkspaceExcludeRules
      )
    );
  }

  isIncluded(filePath) {
    return !!this.getIncluded([filePath]).length;
  }

  async getFilePaths(rootPaths): Promise<string[]> {
    const config = Config.get();

    return discoverTodoFiles(
      rootPaths,
      getTaskFileIncludes(config),
      config.file.exclude || [],
      !!config.followSymlinks,
      getWorkspaceExcludeRules
    );
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
          const revision = this.fileDataRevisions[filePath] || 0;
          const data = await this.getFileData(filePath);
          if (revision === (this.fileDataRevisions[filePath] || 0)) {
            this.filesData[filePath] = data;
          }
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

    // VS Code can close a document loaded for discovery and later reopen a new
    // instance. Keep cached file metadata attached to the current live buffer.
    const documents = new Map<string, TextDocument>();
    (vscode.workspace.textDocuments || []).forEach((document) => {
      if (document.uri.scheme === 'file' && !document.isClosed)
        documents.set(document.uri.fsPath.replace(/\\/g, '/'), document);
    });
    Object.keys(this.filesData).forEach((filePath) => {
      const data = this.filesData[filePath],
        document = documents.get(filePath);
      if (data && document) data.textEditor = document;
    });

    const pending = Object.keys(this.filesData).filter((filePath) => !this.filesData[filePath]);
    if (!pending.length) return;

    const BATCH_SIZE = getBatchSize(Config.get().file.batchSize);
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      await mapFulfilled(
        batch,
        async (filePath: string) => {
          const revision = this.fileDataRevisions[filePath] || 0;
          const data = await this.getFileData(filePath);
          if (revision === (this.fileDataRevisions[filePath] || 0)) {
            this.filesData[filePath] = data;
          }
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

    const todos = Object.create(null), // { [ROOT] { { [FILEPATH] => [DATA] } }
      filePaths = Object.keys(this.filesData),
      markdown = getMarkdownTaskSettings();
    const visibleFiles = filePaths
      .map((filePath) => ({ filePath, data: this.filesData[filePath] }))
      .filter(({ filePath, data }) => {
        if (!data) return false;
        if (isMarkdownTaskDocument(data.textEditor, markdown)) {
          const nodes = getMarkdownTaskNodes(data.textEditor, markdown);
          if (!nodes.some((node) => node.kind === 'todo')) return false;
          return (
            !filter ||
            matchesFilesViewFilter(
              filter,
              filePath,
              nodes.map((node) => node.title)
            )
          );
        }
        return !filter || matchesFilesViewFilter(filter, filePath, [data.textEditor.getText()]);
      });
    const rootKeys = getUniqueRootKeys(
      visibleFiles.map(({ data }) => ({ root: data.root, rootPath: data.rootPath }))
    );

    visibleFiles.forEach(({ filePath, data }, index) => {
      const root = rootKeys[index];

      if (!todos[root]) todos[root] = Object.create(null);

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
