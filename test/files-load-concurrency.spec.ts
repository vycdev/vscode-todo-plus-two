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
      textDocuments: [] as any[],
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
      if (request === './folder') return { default: { getAllRootPaths: () => ['/workspace'] } };
      if (request === './workspace-excludes') return { getWorkspaceExcludeRules: () => [] };
      if (request === './task-source')
        return {
          getTaskFileIncludes: (config) => config.file.include,
          isMarkdownTaskDocument: () => false,
          getMarkdownTaskSettings: () => ({ enabled: false }),
        };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[modulePath];
    return {
      files: require(modulePath).default,
      workspace: vscode.workspace,
      watcherCount: () => watchersCreated,
    };
  } finally {
    NodeModule._load = originalLoad;
    if (previousModule) require.cache[modulePath] = previousModule;
    else delete require.cache[modulePath];
  }
};

describe('Todo file loading', () => {
  it('refreshes cached snapshots from reopened live buffers before filtering', async () => {
    const { files, workspace } = loadFiles();
    const filePath = 'C:/workspace/tasks.todo';
    const previous = { isClosed: true, version: 1, getText: () => '☐ Work @low' };
    const current = {
      uri: { scheme: 'file', fsPath: 'C:\\workspace\\tasks.todo' },
      languageId: 'todo',
      isClosed: false,
      version: 1,
      getText: () => '☐ Work @now',
    };
    const data = {
      filePath,
      root: 'workspace',
      rootPath: 'C:/workspace',
      relativePath: 'tasks.todo',
      textEditor: previous,
    };
    files.filesData = { [filePath]: data };
    workspace.textDocuments = [current];
    files.getFileData = async () => {
      throw new Error('A live buffer must not be reloaded');
    };

    await files.updateFilesData();

    expect(data.textEditor).to.equal(current);
    expect(files.getTodos('@now').workspace[filePath]).to.equal(data);
    expect(files.getTodos('@low')).to.deep.equal({});
    expect(previous.getText()).to.equal('☐ Work @low');
  });

  it('ignores closed, untitled, and undiscovered buffers when refreshing file data', async () => {
    const { files, workspace } = loadFiles();
    const cached = { getText: () => '☐ Work @low' };
    files.filesData = { '/workspace/tasks.todo': { textEditor: cached } };
    workspace.textDocuments = [
      { uri: { scheme: 'file', fsPath: '/workspace/tasks.todo' }, isClosed: true },
      { uri: { scheme: 'untitled', fsPath: '/workspace/tasks.todo' }, isClosed: false },
      { uri: { scheme: 'file', fsPath: '/workspace/untracked.todo' }, isClosed: false },
    ];

    await files.updateFilesData();

    expect(files.filesData['/workspace/tasks.todo'].textEditor).to.equal(cached);
    expect(Object.keys(files.filesData)).to.deep.equal(['/workspace/tasks.todo']);
  });

  it('loads discovered documents once and reuses them for later document requests', async () => {
    const { files } = loadFiles();
    const opened: string[] = [];
    files.getFilePaths = async () => ['/workspace/a.todo', '/workspace/b.todo'];
    files.getFileData = async (filePath) => {
      opened.push(filePath);
      return {
        filePath,
        textEditor: { uri: { scheme: 'file', fsPath: filePath }, isDirty: false },
      };
    };

    const first = await files.getDocuments();
    const second = await files.getDocuments();

    expect(Object.keys(first)).to.deep.equal(['/workspace/a.todo', '/workspace/b.todo']);
    expect(second['/workspace/a.todo']).to.equal(first['/workspace/a.todo']);
    expect(opened).to.deep.equal(['/workspace/a.todo', '/workspace/b.todo']);
  });

  it('reloads a closed buffer only when it was the cached copy', async () => {
    const { files } = loadFiles();
    const opened: string[] = [];
    files.getFilePaths = async () => ['/workspace/a.todo'];
    files.getFileData = async (filePath) => {
      opened.push(filePath);
      return { filePath, textEditor: { uri: { scheme: 'file', fsPath: filePath } } };
    };
    const loaded = (await files.getDocuments())['/workspace/a.todo'];

    files.invalidateDocument({ uri: { scheme: 'file', fsPath: '/workspace/a.todo' } });
    await files.getDocuments();
    expect(opened).to.have.length(1);

    files.invalidateDocument(loaded);
    const reloaded = (await files.getDocuments())['/workspace/a.todo'];
    expect(opened).to.have.length(2);
    expect(reloaded).not.to.equal(loaded);
  });

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
