/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Consts from '../consts';
import { DependencyReference, DependencyTarget, getDependencies, getIds } from './dependencies';
import Files from './files';
import Folder from './folder';
import Regex from './regex';

/* TYPES */

interface DependencyIndex {
    targets: { [id: string]: DependencyTarget[] };
    dependencies: { [id: string]: DependencyTarget[] };
}

/* DEPENDENCY INDEX */

const DependencyIndex = {
    diagnostics: <vscode.DiagnosticCollection>undefined,

    initialize(context: vscode.ExtensionContext) {
        if (DependencyIndex.diagnostics) return;

        DependencyIndex.diagnostics =
            vscode.languages.createDiagnosticCollection('todo-dependencies');

        const updateDiagnostics = _.debounce(() => DependencyIndex.updateDiagnostics(), 250);

        context.subscriptions.push(
            DependencyIndex.diagnostics,
            vscode.workspace.onDidChangeTextDocument(({ document }) => {
                if (document.languageId === Consts.languageId) updateDiagnostics();
            }),
            vscode.workspace.onDidOpenTextDocument((document) => {
                if (document.languageId === Consts.languageId) updateDiagnostics();
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(updateDiagnostics),
            vscode.workspace.onDidChangeConfiguration(updateDiagnostics)
        );

        DependencyIndex.updateDiagnostics();
    },

    async get(document?: vscode.TextDocument): Promise<DependencyIndex> {
        const documents = await DependencyIndex.getTodoDocuments(document);
        const targets: { [id: string]: DependencyTarget[] } = {};
        const dependencies: { [id: string]: DependencyTarget[] } = {};

        documents.forEach((candidate) => {
            for (let lineNumber = 0; lineNumber < candidate.lineCount; lineNumber++) {
                const text = candidate.lineAt(lineNumber).text;
                const makeLocation = (reference: DependencyReference): DependencyTarget => ({
                    ...reference,
                    filePath: candidate.uri.fsPath,
                    lineNumber,
                    text,
                });

                getDependencies(text).forEach((reference) => {
                    const dependency = makeLocation(reference);

                    if (!dependencies[dependency.id]) dependencies[dependency.id] = [];

                    dependencies[dependency.id].push(dependency);
                });

                getIds(text).forEach((reference) => {
                    const target = makeLocation(reference);

                    if (!targets[target.id]) targets[target.id] = [];

                    targets[target.id].push(target);
                });
            }
        });

        return { targets, dependencies };
    },

    isFinished(target: DependencyTarget) {
        return Regex.test(Consts.regexes.todoFinished, target.text);
    },

    async updateDiagnostics(document?: vscode.TextDocument) {
        if (!DependencyIndex.diagnostics) return;

        const index = await DependencyIndex.get(document);
        const diagnostics: { [filePath: string]: vscode.Diagnostic[] } = {};

        Object.keys(index.dependencies).forEach((id) => {
            if (index.targets[id] && index.targets[id].length) return;

            index.dependencies[id].forEach((dependency) => {
                if (!dependency.filePath) return;

                const range = new vscode.Range(
                    dependency.lineNumber,
                    dependency.tagStart,
                    dependency.lineNumber,
                    dependency.tagEnd
                );
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `No task has @id(${id})`,
                    vscode.DiagnosticSeverity.Warning
                );

                diagnostic.source = 'Todo+';

                if (!diagnostics[dependency.filePath]) diagnostics[dependency.filePath] = [];

                diagnostics[dependency.filePath].push(diagnostic);
            });
        });

        DependencyIndex.diagnostics.clear();

        Object.keys(diagnostics).forEach((filePath) => {
            DependencyIndex.diagnostics.set(vscode.Uri.file(filePath), diagnostics[filePath]);
        });
    },

    async getTodoDocuments(document?: vscode.TextDocument) {
        const documents = vscode.workspace.textDocuments
            .filter((candidate) => candidate.languageId === Consts.languageId)
            .slice();

        try {
            const paths = await Files.getFilePaths(Folder.getAllRootPaths());
            const fileDocuments = await Promise.all(
                paths.map((filePath) => vscode.workspace.openTextDocument(filePath))
            );

            fileDocuments.forEach((candidate) => {
                if (
                    !documents.some(
                        (existing) => existing.uri.toString() === candidate.uri.toString()
                    )
                ) {
                    documents.push(candidate);
                }
            });
        } catch (error) {
            console.warn('Todo+: failed to scan workspace todo files', error);
        }

        if (
            document &&
            !documents.some((candidate) => candidate.uri.toString() === document.uri.toString())
        ) {
            documents.push(document);
        }

        return documents;
    },
};

/* EXPORT */

export default DependencyIndex;
