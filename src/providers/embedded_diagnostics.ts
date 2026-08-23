/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Config from '../config';
import {
    EmbeddedDiagnosticSeverity,
    EmbeddedTodo,
    getEmbeddedDiagnosticData,
    normalizeSeverityMap,
} from '../utils/embedded/diagnostics';

/* TYPES */

interface EmbeddedProvider {
    filesData?: { [filePath: string]: EmbeddedTodo[] | undefined };
    get(): Promise<any>;
    getCachedFilePath(filePath: string): string;
    onDidChangeData?: vscode.Event<string | undefined>;
}

interface EmbeddedService {
    initProvider(): Promise<any>;
    provider?: EmbeddedProvider;
}

/* EMBEDDED DIAGNOSTICS */

class EmbeddedDiagnostics {
    private collection: vscode.DiagnosticCollection;
    private embedded: EmbeddedService;
    private dataRevision = 0;
    private fileGenerations: { [filePath: string]: number } = {};
    private generation = 0;
    private provider: EmbeddedProvider;
    private providerDisposable: vscode.Disposable;

    constructor(embedded: EmbeddedService) {
        this.embedded = embedded;
    }

    initialize(context: vscode.ExtensionContext) {
        this.collection = vscode.languages.createDiagnosticCollection('todo-embedded');

        const refreshAll = _.debounce(() => this.refreshAll(), 250);

        context.subscriptions.push(
            this.collection,
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration('todo.embedded') ||
                    event.affectsConfiguration('todo.followSymlinks') ||
                    event.affectsConfiguration('files.exclude')
                ) {
                    refreshAll();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(refreshAll),
            {
                dispose: () => {
                    refreshAll.cancel();
                    if (this.providerDisposable) this.providerDisposable.dispose();
                },
            }
        );

        this.refreshAll();
    }

    async refreshAll() {
        if (!this.collection) return;

        const generation = ++this.generation,
            dataRevision = this.dataRevision,
            mapping = Config.getKey('embedded.problems'),
            severities = normalizeSeverityMap(mapping);

        if (!Object.keys(severities).length) {
            this.collection.clear();
            this.clearProvider();
            return;
        }

        const provider = await this.getProvider();

        if (!provider) {
            this.collection.clear();
            return;
        }

        await provider.get();

        if (generation !== this.generation || provider !== this.embedded.provider) return;

        if (dataRevision !== this.dataRevision) {
            this.refreshAll();
            return;
        }

        this.collection.clear();

        Object.keys(provider.filesData || {}).forEach((filePath) => {
            this.setFileDiagnostics(filePath, provider.filesData[filePath] || [], mapping);
        });
    }

    private async getProvider(): Promise<EmbeddedProvider | undefined> {
        await this.embedded.initProvider();

        const provider = this.embedded.provider;

        if (!provider) {
            this.clearProvider();
            return;
        }

        if (provider === this.provider) return provider;

        this.clearProvider();
        this.provider = provider;
        this.providerDisposable = provider.onDidChangeData
            ? provider.onDidChangeData((filePath) =>
                  filePath === undefined ? this.refreshAll() : this.refreshFile(filePath)
              )
            : undefined;

        return provider;
    }

    private clearProvider() {
        if (this.providerDisposable) this.providerDisposable.dispose();

        this.providerDisposable = undefined;
        this.provider = undefined;
    }

    private async refreshFile(filePath: string) {
        const generation = this.generation,
            fileGeneration = (this.fileGenerations[filePath] || 0) + 1,
            mapping = Config.getKey('embedded.problems'),
            severities = normalizeSeverityMap(mapping),
            mappingSignature = JSON.stringify(severities);

        this.fileGenerations[filePath] = fileGeneration;
        this.dataRevision += 1;

        if (!Object.keys(severities).length) {
            this.collection.delete(vscode.Uri.file(filePath));
            return;
        }

        const provider = await this.getProvider();

        if (!provider || !provider.filesData) return;

        const cachedFilePath = provider.getCachedFilePath(filePath);

        if (
            generation !== this.generation ||
            fileGeneration !== this.fileGenerations[filePath] ||
            provider !== this.embedded.provider ||
            mappingSignature !==
                JSON.stringify(normalizeSeverityMap(Config.getKey('embedded.problems')))
        )
            return;

        const todos = provider.filesData[cachedFilePath];

        if (!todos || !todos.length) {
            this.collection.delete(vscode.Uri.file(cachedFilePath));
            return;
        }

        this.setFileDiagnostics(cachedFilePath, todos, mapping);
    }

    private setFileDiagnostics(filePath: string, todos: EmbeddedTodo[], mapping: any) {
        const diagnostics = getEmbeddedDiagnosticData(todos, mapping).map((data) => {
            const range = new vscode.Range(data.line, data.start, data.line, data.end),
                diagnostic = new vscode.Diagnostic(
                    range,
                    data.message,
                    this.getSeverity(data.severity)
                );

            diagnostic.source = 'Todo+2';

            return diagnostic;
        });

        this.collection.set(vscode.Uri.file(filePath), diagnostics);
    }

    private getSeverity(severity: EmbeddedDiagnosticSeverity): vscode.DiagnosticSeverity {
        const values = {
            error: vscode.DiagnosticSeverity.Error,
            warning: vscode.DiagnosticSeverity.Warning,
            info: vscode.DiagnosticSeverity.Information,
            hint: vscode.DiagnosticSeverity.Hint,
        };

        return values[severity];
    }
}

/* EXPORT */

export default EmbeddedDiagnostics;
