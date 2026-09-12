import { expect } from 'chai';

const loadFiles = () => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        modulePath = require.resolve('../src/utils/files'),
        previousModule = require.cache[modulePath];
    let watchersCreated = 0;
    const config = {
        file: { include: ['**/*.todo'], exclude: [], batchSize: 10 },
        followSymlinks: false,
    };
    const vscode = {
        commands: { executeCommand() {} },
        workspace: {
            createFileSystemWatcher() {
                watchersCreated++;
                return { onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose() {} };
            },
        },
    };
    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (parent && parent.filename === modulePath) {
            if (request === 'vscode') return vscode;
            if (request === '../config') return { default: { get: () => config } };
            if (request === '../views/files') return { default: { refresh() {} } };
            if (request === '../views/due') return { Due: { refresh() {} } };
            if (request === './folder')
                return { default: { getAllRootPaths: () => ['/workspace'] } };
            if (request === './workspace-excludes') return { getWorkspaceExcludeRules: () => [] };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[modulePath];
        return { files: require(modulePath).default, watcherCount: () => watchersCreated };
    } finally {
        NodeModule._load = originalLoad;
        if (previousModule) require.cache[modulePath] = previousModule;
        else delete require.cache[modulePath];
    }
};

describe('Todo file loading', () => {
    it('does not let a failed load poison a waiting refresh', async () => {
        const { files } = loadFiles();
        let attempts = 0;
        files.getFilePaths = async () => {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 1));
            if (attempts === 1) throw new Error('temporary scan failure');
            return [];
        };
        const failed = files.get().then(
            () => {
                throw new Error('The first load must fail');
            },
            (error) => expect(error.message).to.equal('temporary scan failure')
        );
        const refreshed = files.get();
        await Promise.all([failed, refreshed]);
        expect(attempts).to.equal(2);
    });

    it('does not read every document body for unfiltered badge loads', () => {
        const { files } = loadFiles();
        let bodyReads = 0;
        files.filesData = {
            '/workspace/TODO': {
                root: 'workspace',
                rootPath: '/workspace',
                textEditor: {
                    getText: () => {
                        bodyReads++;
                        return '☐ task';
                    },
                },
            },
        };
        files.getTodos();
        expect(bodyReads).to.equal(0);
        files.getTodos('task');
        expect(bodyReads).to.equal(1);
    });

    it('shares initialization safely when the badge and visible tree load together', async () => {
        const { files, watcherCount } = loadFiles();
        let scans = 0,
            release;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        files.getFilePaths = async () => {
            scans++;
            await gate;
            return [];
        };
        const badge = files.get();
        const tree = files.get();
        release();
        await Promise.all([badge, tree]);
        expect(scans).to.equal(1);
        expect(watcherCount()).to.equal(1);
    });

    it('loads changed workspace roots after an in-flight initialization', async () => {
        const { files } = loadFiles();
        const rootsSeen = [];
        let active = 0,
            maximumActive = 0;
        files.getFilePaths = async (roots) => {
            active++;
            maximumActive = Math.max(maximumActive, active);
            rootsSeen.push(roots);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active--;
            return [];
        };
        await Promise.all([files.get(['/first']), files.get(['/second'])]);
        expect(maximumActive).to.equal(1);
        expect(rootsSeen).to.deep.equal([['/first'], ['/second']]);
        expect(files.rootPaths).to.deep.equal(['/second']);
    });
});
