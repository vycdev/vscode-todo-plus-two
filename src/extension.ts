/* IMPORT */

import * as vscode from 'vscode';
import * as Commands from './commands';
import Config from './config';
import Consts from './consts';
import CompletionProvider from './providers/completion';
import DependencyLinkProvider from './providers/dependency_links';
import FoldingProvider from './providers/folding';
import { FileLinkProvider } from './providers/file_links';
import EmbeddedDiagnostics from './providers/embedded_diagnostics';
import SymbolsProvider from './providers/symbols';
import DocumentDecorator from './todo/decorators/document';
import ChangesDecorator from './todo/decorators/changes';
import Utils from './utils';
import DependencyIndex from './utils/dependency_index';
import ViewEmbedded from './views/embedded';
import ViewFiles from './views/files';
import { Due } from './views/due';
import StatusbarStatistics from './statusbars/statistics';
import StatusbarTimer from './statusbars/timer';
import { getMarkdownTaskNodes, isMarkdownTaskDocument } from './utils/task-source';

/* ACTIVATE */

const activate = function (context: vscode.ExtensionContext) {
  const config = Config.get();
  const updateUnarchiveContext = () =>
    vscode.commands.executeCommand(
      'setContext',
      'todo-unarchive-enabled',
      Config.getKey('archive.type') === 'InSameFile'
    );

  Config.check(config);
  updateUnarchiveContext();
  const updateMarkdownContext = () => {
    const editor = vscode.window.activeTextEditor;
    const enabled = !!editor && isMarkdownTaskDocument(editor.document);
    vscode.commands.executeCommand('setContext', 'todo-markdown-active', enabled);
    vscode.commands.executeCommand(
      'setContext',
      'todo-markdown-task',
      enabled &&
        getMarkdownTaskNodes(editor.document).some(
          (node) => node.kind === 'todo' && node.lineNumber === editor.selection.active.line
        )
    );
  };
  updateMarkdownContext();

  ViewEmbedded.expanded = config.embedded.view.expanded;

  vscode.commands.executeCommand('setContext', 'todo-embedded-expanded', ViewEmbedded.expanded);
  vscode.commands.executeCommand('setContext', 'todo-embedded-filtered', !!ViewEmbedded.filter);

  ViewEmbedded.all = true;

  vscode.commands.executeCommand('setContext', 'todo-embedded-all', !!ViewEmbedded.all);

  ViewFiles.expanded = config.file.view.expanded;

  vscode.commands.executeCommand('setContext', 'todo-files-expanded', ViewFiles.expanded);
  vscode.commands.executeCommand('setContext', 'todo-files-filtered', !!ViewFiles.filter);
  vscode.commands.executeCommand('setContext', 'todo-files-show-finished', ViewFiles.showFinished);
  vscode.commands.executeCommand('setContext', 'todo-files-open-button', true);

  Utils.context = context;
  Utils.folder.initRootsRe();
  DependencyIndex.initialize(context);
  new EmbeddedDiagnostics(Utils.embedded).initialize(context);
  Utils.init.language(context);
  Utils.statistics.tokens.updateDisabledAll();

  const embeddedRefreshTimers = {};
  let dueRefreshTimer;
  let disposed = false;
  const dueRefresh = () => {
    if (disposed) return;
    clearTimeout(dueRefreshTimer);
    dueRefreshTimer = setTimeout(() => {
      Due.refresh();
      ViewFiles.refreshActivityBarBadge();
    }, 250);
  };
  const refreshDueDocument = (document: vscode.TextDocument) => {
    if (document.uri.scheme !== 'file') return;

    const filePath = document.uri.fsPath.replace(/\\/g, '/'),
      filesData = Utils.files.filesData;

    if (
      document.languageId === Consts.languageId ||
      isMarkdownTaskDocument(document) ||
      (filesData && filesData.hasOwnProperty(filePath))
    ) {
      dueRefresh();
    }
  };
  const refreshEmbeddedDocument = (document: vscode.TextDocument) => {
    if (disposed || document.uri.scheme !== 'file') return;

    const key = document.uri.fsPath;

    clearTimeout(embeddedRefreshTimers[key]);

    embeddedRefreshTimers[key] = setTimeout(() => {
      delete embeddedRefreshTimers[key];

      const provider: any = Utils.embedded.provider;

      if (!provider || typeof provider.updateDocumentData !== 'function') return;

      const filePath = provider.updateDocumentData(document);

      if (filePath) ViewEmbedded.refreshFile(filePath);
    }, 250);
  };
  const updateFileCaches = (event: vscode.ConfigurationChangeEvent) => {
    Utils.files.unwatchPaths();

    if (event.affectsConfiguration('todo.embedded.provider')) {
      Utils.embedded.resetProvider();
    } else if (Utils.embedded.provider) {
      Utils.embedded.provider.unwatchPaths();
    }
  };

  context.subscriptions.push(
    StatusbarStatistics,
    StatusbarTimer,
    Utils.command,
    Utils.log,
    {
      dispose: () => {
        disposed = true;
        clearTimeout(dueRefreshTimer);
        Object.keys(embeddedRefreshTimers).forEach((key) =>
          clearTimeout(embeddedRefreshTimers[key])
        );
        Utils.files.dispose();
        Utils.embedded.dispose();
      },
    },
    vscode.languages.registerCompletionItemProvider(
      [Consts.languageId, 'markdown'],
      new CompletionProvider(),
      ...CompletionProvider.triggerCharacters
    ),
    vscode.languages.registerDocumentLinkProvider(
      [Consts.languageId, 'markdown'],
      new DependencyLinkProvider()
    ),
    vscode.languages.registerFoldingRangeProvider(Consts.languageId, new FoldingProvider()),
    vscode.languages.registerDocumentLinkProvider(
      [Consts.languageId, 'markdown'],
      new FileLinkProvider()
    ),
    vscode.languages.registerDocumentSymbolProvider(Consts.languageId, new SymbolsProvider()),
    vscode.window.onDidChangeActiveTextEditor(() => DocumentDecorator.update()),
    vscode.window.onDidChangeActiveTextEditor(updateMarkdownContext),
    vscode.window.onDidChangeTextEditorSelection(updateMarkdownContext),
    vscode.workspace.onDidChangeConfiguration(Consts.update),
    vscode.workspace.onDidChangeConfiguration(updateUnarchiveContext),
    vscode.workspace.onDidChangeConfiguration(updateMarkdownContext),
    vscode.workspace.onDidChangeConfiguration(updateFileCaches),
    vscode.workspace.onDidChangeConfiguration(Utils.statistics.tokens.updateDisabledAll),
    vscode.workspace.onDidChangeConfiguration(() => DocumentDecorator.update()),
    vscode.workspace.onDidChangeTextDocument(ChangesDecorator.onChanges),
    vscode.workspace.onDidChangeTextDocument(updateMarkdownContext),
    vscode.workspace.onDidChangeTextDocument(({ document }) => refreshEmbeddedDocument(document)),
    vscode.workspace.onDidChangeTextDocument(({ document }) => refreshDueDocument(document)),
    Due.onDidChangeDate(() => {
      vscode.window.visibleTextEditors
        .filter((editor) => Utils.editor.isSupported(editor))
        .forEach((editor) => DocumentDecorator.update(editor));
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(
      () => Utils.embedded.provider && Utils.embedded.provider.unwatchPaths()
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => Utils.files.unwatchPaths()),
    vscode.workspace.onDidChangeWorkspaceFolders(Utils.folder.initRootsRe),
    vscode.workspace.onDidChangeWorkspaceFolders(() => ViewFiles.refresh())
  );

  Utils.init.views(context);

  DocumentDecorator.update();

  Commands.registerCommands(context, Commands);
  return Commands;
};

/* EXPORT */

export { activate };
