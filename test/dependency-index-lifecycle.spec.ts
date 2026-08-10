import { expect } from 'chai';

const loadDependencyIndex = () => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        dependencyIndexPath = require.resolve('../src/utils/dependency_index'),
        previousDependencyIndex = require.cache[dependencyIndexPath];
    let closeListener: (document: { languageId: string }) => void;
    let cancelCount = 0,
        clearCount = 0;

    const disposable = { dispose: () => undefined };
    const diagnostics = {
        ...disposable,
        clear: () => {
            clearCount += 1;
        },
        set: () => undefined,
    };
    const register = () => disposable;
    const vscode = {
        languages: {
            createDiagnosticCollection: () => diagnostics,
        },
        workspace: {
            onDidChangeTextDocument: register,
            onDidOpenTextDocument: register,
            onDidCloseTextDocument: (listener) => {
                closeListener = listener;
                return disposable;
            },
            onDidChangeWorkspaceFolders: register,
            onDidChangeConfiguration: register,
        },
    };

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'lodash') {
            return {
                debounce: (callback) => {
                    callback.cancel = () => {
                        cancelCount += 1;
                    };
                    return callback;
                },
            };
        }
        if (request === 'vscode') return vscode;
        if (request === '../consts') return { default: { languageId: 'todo' } };
        if (request === './dependencies') return {};
        if (request === './document-loader') return {};
        if (request === './files') return { default: {} };
        if (request === './folder') return { default: {} };
        if (request === './regex') return { default: {} };

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[dependencyIndexPath];
        return {
            DependencyIndex: require('../src/utils/dependency_index').default,
            diagnostics,
            getCloseListener: () => closeListener,
            getCancelCount: () => cancelCount,
            getClearCount: () => clearCount,
        };
    } finally {
        NodeModule._load = originalLoad;
        if (previousDependencyIndex) {
            require.cache[dependencyIndexPath] = previousDependencyIndex;
        } else {
            delete require.cache[dependencyIndexPath];
        }
    }
};

describe('Dependency index lifecycle', () => {
    it('refreshes diagnostics when a Todo document closes', () => {
        const { DependencyIndex, getCloseListener, getCancelCount } = loadDependencyIndex(),
            subscriptions = [];
        let updateCount = 0;

        DependencyIndex.updateDiagnostics = () => {
            updateCount += 1;
        };
        DependencyIndex.initialize({ subscriptions });

        expect(getCloseListener()).to.be.a('function');
        expect(updateCount).to.equal(1);

        getCloseListener()({ languageId: 'typescript' });
        expect(updateCount).to.equal(1);

        getCloseListener()({ languageId: 'todo' });
        expect(updateCount).to.equal(2);

        subscriptions[1].dispose();
        expect(getCancelCount()).to.equal(1);
    });

    it('does not publish results from an older diagnostics refresh', async () => {
        const { DependencyIndex, diagnostics, getClearCount } = loadDependencyIndex(),
            resolvers = [];

        DependencyIndex.diagnostics = diagnostics;
        DependencyIndex.get = () =>
            new Promise((resolve) => {
                resolvers.push(resolve);
            });

        const firstRefresh = DependencyIndex.updateDiagnostics(),
            secondRefresh = DependencyIndex.updateDiagnostics(),
            emptyIndex = { targets: {}, dependencies: {} };

        resolvers[1](emptyIndex);
        await secondRefresh;

        resolvers[0](emptyIndex);
        await firstRefresh;

        expect(getClearCount()).to.equal(1);
    });
});
