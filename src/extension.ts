/* IMPORT */

import * as vscode from 'vscode';
import beggar from 'vscode-beggar';
import Config from './config';
import Consts from './consts';
import CompletionProvider from './providers/completion';
import DependencyLinkProvider from './providers/dependency_links';
import SymbolsProvider from './providers/symbols';
import DocumentDecorator from './todo/decorators/document';
import ChangesDecorator from './todo/decorators/changes';
import Utils from './utils';
import DependencyIndex from './utils/dependency_index';
import ViewEmbedded from './views/embedded';
import ViewFiles from './views/files';

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

    ViewEmbedded.expanded = config.embedded.view.expanded;

    vscode.commands.executeCommand('setContext', 'todo-embedded-expanded', ViewEmbedded.expanded);
    vscode.commands.executeCommand('setContext', 'todo-embedded-filtered', !!ViewEmbedded.filter);

    ViewEmbedded.all = true;

    vscode.commands.executeCommand('setContext', 'todo-embedded-all', !!ViewEmbedded.all);

    ViewFiles.expanded = config.file.view.expanded;

    vscode.commands.executeCommand('setContext', 'todo-files-expanded', ViewFiles.expanded);
    vscode.commands.executeCommand(
        'setContext',
        'todo-files-show-finished',
        ViewFiles.showFinished
    );
    vscode.commands.executeCommand('setContext', 'todo-files-open-button', true);

    Utils.context = context;
    Utils.folder.initRootsRe();
    DependencyIndex.initialize(context);
    Utils.init.language();
    Utils.init.views();
    Utils.statistics.tokens.updateDisabledAll();

    const embeddedRefreshTimers = {};
    const refreshEmbeddedDocument = (document: vscode.TextDocument) => {
        if (document.uri.scheme !== 'file') return;

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

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            Consts.languageId,
            new CompletionProvider(),
            ...CompletionProvider.triggerCharacters
        ),
        vscode.languages.registerDocumentLinkProvider(
            Consts.languageId,
            new DependencyLinkProvider()
        ),
        vscode.languages.registerDocumentSymbolProvider(Consts.languageId, new SymbolsProvider()),
        vscode.window.onDidChangeActiveTextEditor(() => DocumentDecorator.update()),
        vscode.workspace.onDidChangeConfiguration(Consts.update),
        vscode.workspace.onDidChangeConfiguration(updateUnarchiveContext),
        vscode.workspace.onDidChangeConfiguration(
            () =>
                delete Utils.files.filesData &&
                Utils.embedded.provider &&
                delete Utils.embedded.provider.filesData
        ),
        vscode.workspace.onDidChangeConfiguration(() => DocumentDecorator.update()),
        vscode.workspace.onDidChangeConfiguration(Utils.statistics.tokens.updateDisabledAll),
        vscode.workspace.onDidChangeTextDocument(ChangesDecorator.onChanges),
        vscode.workspace.onDidChangeTextDocument(({ document }) =>
            refreshEmbeddedDocument(document)
        ),
        vscode.workspace.onDidChangeWorkspaceFolders(
            () => Utils.embedded.provider && Utils.embedded.provider.unwatchPaths()
        ),
        vscode.workspace.onDidChangeWorkspaceFolders(Utils.files.unwatchPaths),
        vscode.workspace.onDidChangeWorkspaceFolders(Utils.folder.initRootsRe)
    );

    DocumentDecorator.update();

    return Utils.init.commands(context);
};

/* EXPORT */

export { activate };
