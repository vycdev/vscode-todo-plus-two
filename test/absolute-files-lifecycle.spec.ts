import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';

const loadFiles = (include: string[], getExcludes = (_filePath: string): any => ({})) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve('../src/utils/files');
  const previous = require.cache[modulePath];
  const config = { file: { include, exclude: [], batchSize: 10 }, followSymlinks: false };
  const polls = new Map<
    string,
    {
      listener: (current: { nlink: number }, previous: { nlink: number }) => void;
      options: any;
    }
  >();
  const debounces: _.DebouncedFunc<() => void>[] = [];
  const watcherGlobs: string[] = [];
  const workspaceEvents: {
    create?: (event) => void;
    change?: (event) => void;
    delete?: (event) => void;
  } = {};
  let fileRefreshes = 0;
  let dueRefreshes = 0;
  const stubs = {
    lodash: {
      ..._,
      debounce: (callback, wait) => {
        const debounced = _.debounce(callback, wait);
        debounces.push(debounced);
        return debounced;
      },
    },
    fs: {
      watchFile: (filePath, options, listener) =>
        polls.set(path.normalize(filePath), { listener, options }),
      unwatchFile: (filePath, listener) => {
        const key = path.normalize(filePath);
        expect(polls.get(key)!.listener).to.equal(listener);
        polls.delete(key);
      },
    },
    vscode: {
      commands: { executeCommand() {} },
      workspace: {
        openTextDocument: async (filePath) => {
          const text = fs.readFileSync(filePath, 'utf8');
          return { getText: () => text };
        },
        createFileSystemWatcher: (glob) => {
          watcherGlobs.push(glob);
          return {
            onDidCreate: (listener) => {
              workspaceEvents.create = listener;
            },
            onDidChange: (listener) => {
              workspaceEvents.change = listener;
            },
            onDidDelete: (listener) => {
              workspaceEvents.delete = listener;
            },
            dispose() {},
          };
        },
      },
    },
    '../config': { default: { get: () => config, getKey: (key) => _.get(config, key) } },
    '../views/files': { default: { refresh: () => fileRefreshes++ } },
    '../views/due': { Due: { refresh: () => dueRefreshes++ } },
    './folder': {
      default: {
        getAllRootPaths: () => [],
        parsePath: (filePath) => ({
          root: path.basename(path.dirname(filePath)),
          rootPath: path.dirname(filePath),
          relativePath: path.basename(filePath),
        }),
      },
    },
    './workspace-excludes': { getWorkspaceExcludeRules: getExcludes },
    './task-source': {
      getTaskFileIncludes: (config) => config.file.include,
      isMarkdownTaskDocument: () => false,
      getMarkdownTaskSettings: () => ({ enabled: false }),
    },
  };
  NodeModule._load = (request, parent, isMain) =>
    parent && parent.filename === modulePath && Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);

  try {
    delete require.cache[modulePath];
    return {
      files: require(modulePath).default,
      config,
      polls,
      notify: (filePath: string, currentLinks = 1, previousLinks = 1) =>
        polls.get(filePath)!.listener({ nlink: currentLinks }, { nlink: previousLinks }),
      watcherGlobs,
      workspaceEvents,
      flush: () => debounces.slice().forEach((debounced) => debounced.flush()),
      refreshes: () => ({ files: fileRefreshes, due: dueRefreshes }),
    };
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

describe('Absolute Todo file refresh lifecycle', () => {
  let fixture: string;
  let globalFile: string;
  let service: ReturnType<typeof loadFiles>;
  const key = (filePath: string) => filePath.replace(/\\/g, '/');

  beforeEach(() => {
    service = undefined;
    fixture = fs.mkdtempSync(path.join(process.cwd(), '.absolute-file-lifecycle-'));
    globalFile = path.join(fixture, 'global.todo');
    fs.writeFileSync(globalFile, '☐ first task');
  });

  afterEach(() => {
    if (service) service.files.dispose();
    expect(path.dirname(fixture)).to.equal(process.cwd());
    expect(path.basename(fixture)).to.match(/^\.absolute-file-lifecycle-/);
    fs.readdirSync(fixture).forEach((entry) => fs.unlinkSync(path.join(fixture, entry)));
    fs.rmdirSync(fixture);
  });

  it('refreshes edits, deletion, and recreation without a workspace', async () => {
    service = loadFiles([globalFile]);
    await service.files.get([]);
    expect(service.files.filesData[key(globalFile)].textEditor.getText()).to.equal('☐ first task');
    expect(service.watcherGlobs).to.deep.equal([]);
    expect(service.polls.get(globalFile)!.options).to.include({
      persistent: false,
      interval: 1000,
    });

    fs.writeFileSync(globalFile, '☐ changed task');
    service.notify(globalFile);
    service.flush();
    expect(service.refreshes()).to.deep.equal({ files: 1, due: 1 });
    await service.files.get([]);
    expect(service.files.filesData[key(globalFile)].textEditor.getText()).to.equal(
      '☐ changed task'
    );

    fs.unlinkSync(globalFile);
    service.notify(globalFile, 0, 1);
    service.flush();
    await service.files.get([]);
    expect(Object.keys(service.files.filesData)).to.deep.equal([]);
    expect(service.polls.has(globalFile)).to.equal(true);

    fs.writeFileSync(globalFile, '☐ recreated task');
    service.notify(globalFile, 1, 0);
    service.flush();
    await service.files.get([]);
    expect(service.files.filesData[key(globalFile)].textEditor.getText()).to.equal(
      '☐ recreated task'
    );
  });

  it('starts watching a missing configured file so it can appear later', async () => {
    fs.unlinkSync(globalFile);
    service = loadFiles([globalFile]);
    await service.files.get([]);
    expect(Object.keys(service.files.filesData)).to.deep.equal([]);
    expect(service.polls.has(globalFile)).to.equal(true);

    service.notify(globalFile, 0, 0);
    service.flush();
    expect(service.refreshes()).to.deep.equal({ files: 0, due: 0 });

    fs.writeFileSync(globalFile, '☐ new file');
    service.notify(globalFile, 1, 0);
    service.flush();
    await service.files.get([]);
    expect(Object.keys(service.files.filesData)).to.deep.equal([key(globalFile)]);
  });

  it('keeps glob/literal duplicates deduplicated after polling and project switches', async () => {
    service = loadFiles(['**/*.todo', globalFile, key(globalFile)]);
    await service.files.get([fixture]);
    expect(Object.keys(service.files.filesData)).to.deep.equal([key(globalFile)]);
    expect(service.polls.size).to.equal(1);
    expect(service.watcherGlobs).to.deep.equal(['**/*.todo']);

    service.notify(globalFile);
    service.flush();
    await service.files.get([fixture]);
    expect(Object.keys(service.files.filesData)).to.deep.equal([key(globalFile)]);
    await service.files.get([]);
    expect(Object.keys(service.files.filesData)).to.deep.equal([key(globalFile)]);
  });

  ['create', 'change'].forEach((event) => {
    it(`keeps a global file deduplicated when a workspace alias emits a ${event} event`, async () => {
      service = loadFiles(['**/*.todo', globalFile]);
      service.config.followSymlinks = true;
      await service.files.get([fixture]);
      const link = path.join(fixture, 'linked.todo');
      fs.symlinkSync(globalFile, link, 'file');

      service.workspaceEvents[event]({ fsPath: link });
      service.flush();
      await service.files.get([fixture]);
      expect(Object.keys(service.files.filesData)).to.have.length(1);
    });
  });

  ['delete', 'change'].forEach((event) => {
    it(`keeps the configured file visible when a removed workspace alias emits ${event}`, async () => {
      const link = path.join(fixture, 'aaa-linked.todo');
      fs.symlinkSync(globalFile, link, 'file');
      service = loadFiles(['aaa*.todo', globalFile]);
      service.config.followSymlinks = true;
      await service.files.get([fixture]);
      expect(Object.keys(service.files.filesData)).to.deep.equal([key(link)]);

      fs.unlinkSync(link);
      service.workspaceEvents[event]({ fsPath: link });
      service.flush();
      await service.files.get([fixture]);
      expect(Object.keys(service.files.filesData)).to.deep.equal([key(globalFile)]);
    });
  });

  it('reconciles both configured files when a displayed alias is retargeted', async () => {
    const secondFile = path.join(fixture, 'second.todo');
    const link = path.join(fixture, 'aaa-linked.todo');
    fs.writeFileSync(secondFile, '☐ second task');
    fs.symlinkSync(globalFile, link, 'file');
    service = loadFiles(['aaa*.todo', globalFile, secondFile]);
    service.config.followSymlinks = true;
    await service.files.get([fixture]);

    fs.unlinkSync(link);
    fs.symlinkSync(secondFile, link, 'file');
    service.workspaceEvents.change!({ fsPath: link });
    service.flush();
    await service.files.get([fixture]);
    const contents = Object.keys(service.files.filesData).map((filePath) =>
      service.files.filesData[filePath].textEditor.getText()
    );
    expect(contents).to.have.members(['☐ first task', '☐ second task']);
  });

  it('keeps ordinary cached edits and excluded workspace events incremental', async () => {
    const localFile = path.join(fixture, 'local.todo');
    const ignoredFile = path.join(fixture, 'ignored.todo');
    fs.writeFileSync(localFile, '☐ local task');
    fs.writeFileSync(ignoredFile, '☐ ignored task');
    service = loadFiles(['**/*.todo', globalFile]);
    service.config.file.exclude = ['**/ignored.todo'];
    const discover = service.files.getFilePaths.bind(service.files);
    let scans = 0;
    service.files.getFilePaths = (roots) => {
      scans++;
      return discover(roots);
    };
    await service.files.get([fixture]);

    fs.writeFileSync(localFile, '☐ edited local task');
    service.workspaceEvents.change!({ fsPath: localFile });
    service.flush();
    await service.files.get([fixture]);
    expect(service.files.filesData[key(localFile)].textEditor.getText()).to.equal(
      '☐ edited local task'
    );
    expect(scans).to.equal(1);

    service.workspaceEvents.change!({ fsPath: ignoredFile });
    service.flush();
    await service.files.get([fixture]);
    expect(scans).to.equal(1);

    fs.unlinkSync(ignoredFile);
    service.workspaceEvents.delete!({ fsPath: ignoredFile });
    service.flush();
    await service.files.get([fixture]);
    expect(scans).to.equal(1);
  });

  it('reacts to conditional exclusion siblings outside the workspace', async () => {
    const sibling = path.join(fixture, 'global.txt');
    service = loadFiles([globalFile], () => ({ '**/*.todo': { when: '$(basename).txt' } }));
    await service.files.get([]);
    expect(service.polls.has(sibling)).to.equal(true);

    fs.writeFileSync(sibling, '');
    service.notify(sibling, 1, 0);
    service.flush();
    await service.files.get([]);
    expect(Object.keys(service.files.filesData)).to.deep.equal([]);

    fs.unlinkSync(sibling);
    service.notify(sibling, 0, 1);
    service.flush();
    await service.files.get([]);
    expect(Object.keys(service.files.filesData)).to.deep.equal([key(globalFile)]);
  });

  it('removes watches and cached files when configuration changes and ignores stale callbacks', async () => {
    service = loadFiles([globalFile]);
    await service.files.get([]);
    const oldListener = service.polls.get(globalFile)!.listener;
    service.config.file.include = [];
    await service.files.get([]);
    expect(service.polls.size).to.equal(0);
    expect(Object.keys(service.files.filesData)).to.deep.equal([]);
    oldListener({ nlink: 1 }, { nlink: 1 });
    service.flush();
    expect(service.refreshes()).to.deep.equal({ files: 0, due: 0 });
  });

  it('cancels pending refreshes and unregisters only its own polling listeners on disposal', async () => {
    service = loadFiles([globalFile]);
    await service.files.get([]);
    const listener = service.polls.get(globalFile)!.listener;
    listener({ nlink: 1 }, { nlink: 1 });
    service.files.dispose();
    expect(service.polls.size).to.equal(0);
    listener({ nlink: 1 }, { nlink: 1 });
    service.flush();
    expect(service.refreshes()).to.deep.equal({ files: 0, due: 0 });
  });
});
