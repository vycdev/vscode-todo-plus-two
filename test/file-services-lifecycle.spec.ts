import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { findClosestRootPath } from '../src/utils/file-globs';

const loadService = (moduleName: string, extraStubs = {}) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve(moduleName);
  const previous = require.cache[modulePath];
  const config = {
    file: { include: ['**/*.todo'], exclude: [] },
    embedded: { include: ['**/*.ts'], exclude: [], provider: 'rg' },
  };
  const folder = { getAllRootPaths: () => ['/workspace'] };
  const stubs = {
    vscode: {
      EventEmitter: class {
        event = () => ({ dispose() {} });
        fire() {}
        dispose() {}
      },
      ProgressLocation: { Window: 1 },
      Uri: { file: (filePath) => filePath },
      commands: { executeCommand: () => Promise.resolve() },
      workspace: { getConfiguration: () => ({ get: () => ({}) }) },
      window: { withProgress: (_options, callback) => callback({ report() {} }) },
    },
    '../config': { default: { get: () => config } },
    '../../config': { default: { get: () => config } },
    '../../../config': { default: { get: () => config } },
    '../views/files': { default: {} },
    '../views/due': { Due: {} },
    '../../../views/embedded': { default: {} },
    '../../../consts': { default: {} },
    './folder': { default: folder },
    '../../folder': { default: folder },
    ...extraStubs,
  };
  NodeModule._load = (request, parent, isMain) =>
    Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);

  try {
    delete require.cache[modulePath];
    return require(moduleName).default;
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

describe('Embedded workspace path aliases', () => {
  let fixture: string;
  let workspace: string;
  let alias: string;
  let provider;

  beforeEach(() => {
    fixture = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), '.embedded-paths-')));
    workspace = path.join(fixture, 'real', 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    fs.symlinkSync(
      path.dirname(workspace),
      path.join(fixture, 'alias'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    alias = path.join(fixture, 'alias', 'workspace');
    fs.writeFileSync(path.join(workspace, 'index.html'), '<html>No markers</html>');
  });

  afterEach(() => {
    if (provider) provider.dispose();
    provider = undefined;
    const remove = (filePath: string) => {
      if (fs.lstatSync(filePath).isDirectory() && !fs.lstatSync(filePath).isSymbolicLink()) {
        fs.readdirSync(filePath).forEach((entry) => remove(path.join(filePath, entry)));
        fs.rmdirSync(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    };
    remove(fixture);
  });

  const setup = (name: string, rootPaths = [alias], existingDocument?) => {
    const properties = require('../package.json').contributes.configuration.properties;
    const config = {
      followSymlinks: false,
      embedded: { include: ['**/*.html'], exclude: ['**/ignored/**'], batchSize: 50 },
    };
    let content = '<html>No markers</html>';
    const events: { [name: string]: (event: { fsPath: string }) => void } = {};
    const dataChanges: (string | undefined)[] = [];
    let refreshes = 0;
    const polls = new Map<string, () => void>();
    const watched: {
      pattern: any;
      disposed: boolean;
      handlers: { [name: string]: (event) => void };
    }[] = [];
    const document = existingDocument || {
      uri: { scheme: 'file', fsPath: path.join(workspace, 'index.html') },
      isDirty: true,
      getText: () => content,
    };
    const stubs = {
      fs: {
        ...fs,
        watchFile: (filePath, _options, listener) => polls.set(filePath, listener),
        unwatchFile: (filePath, listener) => {
          expect(polls.get(filePath)).to.equal(listener);
          polls.delete(filePath);
        },
      },
      vscode: {
        RelativePattern: class {
          constructor(
            public base: string,
            public pattern: string
          ) {}
        },
        EventEmitter: class {
          event = () => ({ dispose() {} });
          fire(filePath?: string) {
            dataChanges.push(filePath);
          }
          dispose() {}
        },
        ProgressLocation: { Window: 1 },
        workspace: {
          textDocuments: [document],
          createFileSystemWatcher: (pattern) => {
            const record = { pattern, disposed: false, handlers: {} };
            watched.push(record);
            const listen = (name, listener) => {
              events[name] = listener;
              record.handlers[name] = listener;
            };
            return {
              onDidCreate: (listener) => listen('create', listener),
              onDidChange: (listener) => listen('change', listener),
              onDidDelete: (listener) => listen('delete', listener),
              dispose: () => {
                record.disposed = true;
              },
            };
          },
        },
        window: {
          activeTextEditor: { document },
          withProgress: (_options, callback) => callback({ report() {} }),
        },
      },
      '../../../config': {
        default: {
          get: () => config,
          getKey: (key) => (key === 'followSymlinks' ? config.followSymlinks : undefined),
        },
      },
      '../../../consts': {
        default: {
          regexes: {
            todoEmbedded: new RegExp(
              properties['todo.embedded.regex'].default,
              properties['todo.embedded.regexFlags'].default
            ),
          },
        },
      },
      '../../../views/embedded': { default: { refresh: () => refreshes++, refreshFile() {} } },
      '../../workspace-excludes': { getWorkspaceExcludeRules: () => ({}) },
      '../../folder': {
        default: {
          getAllRootPaths: () => rootPaths,
          getRootPath: (filePath) => findClosestRootPath(filePath, rootPaths),
          parsePath: (filePath) => ({
            root: 'workspace',
            rootPath: alias,
            relativePath: path.relative(alias, filePath),
          }),
        },
      },
    };
    const Abstract = loadService('../src/utils/embedded/providers/abstract', stubs);
    const Provider = loadService(`../src/utils/embedded/providers/${name}`, {
      ...stubs,
      './abstract': { default: Abstract },
    });
    provider = new Provider();
    if (name === 'ag') {
      provider.getAckmate = async (filePaths) =>
        filePaths.flatMap((filePath) => {
          if (!fs.existsSync(filePath)) return [];
          return fs
            .readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map((line, lineNr) => ({ filePath, line, lineNr }));
        });
    }

    return {
      document,
      setContent: (value: string) => (content = value),
      changeOnDisk: () => events.change({ fsPath: document.uri.fsPath }),
      notify: (event: string, filePath: string) => events[event]({ fsPath: filePath }),
      dataChanges,
      refreshes: () => refreshes,
      polls,
      watched,
    };
  };

  const getCachedTodos = (): { message: string }[] =>
    Object.keys(provider.filesData).reduce(
      (todos, filePath) => todos.concat(provider.filesData[filePath] || []),
      []
    );

  ['js', 'ag'].forEach((name) => {
    it(`keeps a dirty alias-URI buffer out of the new target in the ${name} provider`, async () => {
      const { document, setContent } = setup(name);
      document.uri.fsPath = path.join(alias, 'index.html');
      setContent('<!--TODO Unsaved A buffer-->');
      await provider.get();
      retargetAlias();
      setContent('<!--TODO Stale A edit-->');
      provider.updateDocumentData(document);
      await provider.get();
      expect(getCachedTodos().map((todo) => todo.message.trim())).to.deep.equal(['Second root']);
      expect(provider.getTodos(false, false, false, false, true)).to.equal(undefined);

      provider.dispose();
      setup(name, [alias], document);
      await provider.get();
      expect(getCachedTodos().map((todo) => todo.message.trim())).to.deep.equal(['Second root']);
    });

    it(`rescans the ${name} provider after a workspace alias changes targets`, async () => {
      fs.writeFileSync(path.join(workspace, 'index.html'), '<!--TODO First root-->');
      const { document, setContent, dataChanges, refreshes } = setup(name);
      setContent('<!--TODO First root-->');
      await provider.get();
      retargetAlias();

      setContent('<!--TODO Unsaved from the previous root-->');
      expect(provider.updateDocumentData(document)).to.equal(undefined);
      expect(Object.keys(provider.filesData)).to.deep.equal([]);
      expect(provider.nonEmptyFiles.size).to.equal(0);
      expect(dataChanges).to.include(undefined);
      expect(refreshes()).to.equal(1);

      await provider.get();
      const data = getCachedTodos();
      expect(data.map((todo) => todo.message.trim())).to.deep.equal(['Second root']);
    });

    it(`keeps the ${name} path index current across watcher additions and deletions`, async () => {
      const { document, setContent, notify } = setup(name);
      await provider.get();
      provider.getCachedFilePath(document.uri.fsPath);

      const filePath = path.join(workspace, 'created.html');
      fs.writeFileSync(filePath, '<!--TODO Created-->');
      document.uri.fsPath = filePath;
      setContent('<!--TODO Created-->');
      notify('create', filePath);
      await provider.dataRefreshQueue;
      expect(getCachedTodos()).to.have.length(1);
      const cached = Object.keys(provider.filesData)[0];
      expect(provider.getCachedFilePath(filePath)).to.equal(cached);

      fs.unlinkSync(filePath);
      notify('delete', filePath);
      await provider.dataRefreshQueue;
      expect(Object.keys(provider.filesData)).to.deep.equal([]);
      expect(provider.nonEmptyFiles.size).to.equal(0);
    });

    it(`reads unsaved HTML before the initial ${name} scan through a workspace alias`, async () => {
      const { setContent } = setup(name);
      setContent('<!--TODO Use grid style-->');

      await provider.get();

      const filePath = Object.keys(provider.filesData)[0];
      expect(Object.keys(provider.filesData).map(path.normalize)).to.deep.equal([
        path.join(alias, 'index.html'),
      ]);
      expect(provider.filesData[filePath][0].message.trim()).to.equal('Use grid style');
    });

    it(`adds, edits, and removes the first unsaved HTML todo after a ${name} scan`, async () => {
      const { document, setContent, changeOnDisk } = setup(name);
      await provider.get();
      expect(Object.keys(provider.filesData)).to.deep.equal([]);

      const filePath = path.join(alias, 'index.html').replace(/\\/g, '/');
      setContent('<!--TODO Use grid style-->');
      expect(provider.updateDocumentData(document)).to.equal(filePath);
      expect(Object.keys(provider.filesData)).to.deep.equal([filePath]);
      expect(provider.getTodos(false, false, false, false, true)['']['']['']).to.have.length(1);

      setContent('<!--TODO Updated without saving-->');
      provider.updateDocumentData(document);
      changeOnDisk();
      await provider.dataRefreshQueue;
      expect(Object.keys(provider.filesData)).to.deep.equal([filePath]);
      expect(provider.filesData[filePath][0].message.trim()).to.equal('Updated without saving');

      setContent('<html>No markers</html>');
      provider.updateDocumentData(document);
      expect(Object.keys(provider.filesData)).to.deep.equal([]);
      expect(provider.nonEmptyFiles.size).to.equal(0);
    });
  });

  const retargetAlias = () => {
    const other = path.join(fixture, 'other', 'workspace');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'index.html'), '<!--TODO Second root-->');
    fs.unlinkSync(path.dirname(alias));
    fs.symlinkSync(
      path.dirname(other),
      path.dirname(alias),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  };

  it('rebinds an alias buffer only after a clean reload agrees with the new target', async () => {
    const { document, setContent } = setup('js');
    document.uri.fsPath = path.join(alias, 'index.html');
    setContent('<!--TODO Old A buffer-->');
    await provider.get();
    retargetAlias();
    document.isDirty = false;
    await provider.get();
    expect(getCachedTodos().map((todo) => todo.message.trim())).to.deep.equal(['Second root']);

    setContent('<!--TODO Second root-->');
    provider.updateDocumentData(document);
    document.isDirty = true;
    setContent('<!--TODO New B edit-->');
    provider.updateDocumentData(document);
    expect(getCachedTodos().map((todo) => todo.message.trim())).to.deep.equal(['New B edit']);
  });

  it('polls alias identity and rebinds physical watches without an editor event', async () => {
    const { document, setContent, notify, polls, watched } = setup('js');
    await provider.get();
    expect(polls.has(alias)).to.equal(true);
    expect(watched.some((watch) => watch.pattern.base === workspace)).to.equal(true);
    const staleDelete = watched[0].handlers.delete;
    retargetAlias();
    const previousWatches = watched.slice();
    polls.get(alias)();
    expect(previousWatches.every((watch) => watch.disposed)).to.equal(true);
    expect(polls.size).to.equal(0);
    await provider.get();
    const other = path.join(fixture, 'other', 'workspace');
    expect(watched.some((watch) => !watch.disposed && watch.pattern.base === other)).to.equal(true);

    document.uri.fsPath = path.join(other, 'index.html');
    setContent('<!--TODO Fresh B filesystem update-->');
    notify('change', document.uri.fsPath);
    staleDelete({ fsPath: path.join(alias, 'index.html') });
    await provider.dataRefreshQueue;
    expect(getCachedTodos().map((todo) => todo.message.trim())).to.deep.equal([
      'Fresh B filesystem update',
    ]);
    provider.dispose();
    expect(polls.size).to.equal(0);
    expect(watched.every((watch) => watch.disposed)).to.equal(true);
  });

  it('keeps the newer edit when it arrives during an initial aliased scan', async () => {
    const { document, setContent } = setup('js');
    setContent('<!--TODO Before pending scan-->');
    let started: () => void;
    let release: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = provider.getFileData.bind(provider);
    provider.getFileData = async (filePath) => {
      const data = await read(filePath);
      started();
      await pendingRead;
      return data;
    };
    const pending = provider.get();
    await reading;
    setContent('<!--TODO Newer edit-->');
    provider.updateDocumentData(document);
    release();
    await pending;
    expect(getCachedTodos().map((todo) => todo.message.trim())).to.deep.equal(['Newer edit']);
    expect(Object.keys(provider.filesData)).to.have.length(1);
  });

  it('detects a changed alias target when requesting cached results', async () => {
    fs.writeFileSync(path.join(workspace, 'index.html'), '<!--TODO First root-->');
    setup('js');
    await provider.get();
    retargetAlias();

    await provider.get();
    const data = getCachedTodos();
    expect(data.map((todo) => todo.message.trim())).to.deep.equal(['Second root']);
  });

  it('rescans an initially empty workspace when its alias changes targets', async () => {
    fs.unlinkSync(path.join(workspace, 'index.html'));
    setup('js');
    await provider.get();
    expect(Object.keys(provider.filesData)).to.deep.equal([]);
    retargetAlias();

    await provider.get();
    expect(getCachedTodos().map((todo) => todo.message.trim())).to.deep.equal(['Second root']);
  });

  it('discards a pending JavaScript read from the previous alias target', async () => {
    const { document, setContent } = setup('js');
    let release: () => void;
    let started: () => void;
    const pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const read = provider.getFileData.bind(provider);
    let first = true;
    provider.getFileData = async (filePath) => {
      const data = await read(filePath);
      if (first) {
        first = false;
        started();
        await pendingRead;
      }
      return data;
    };
    setContent('<!--TODO Previous target-->');
    const pending = provider.get();
    await reading;
    retargetAlias();
    setContent('<!--TODO Edited after retargeting-->');
    provider.updateDocumentData(document);
    release();
    await pending;
    expect(Object.keys(provider.filesData)).to.deep.equal([]);

    await provider.get();
    const data = getCachedTodos();
    expect(data.map((todo) => todo.message.trim())).to.deep.equal(['Second root']);
  });

  it('discards pending external search results after a watcher detects a new alias target', async () => {
    const { document, notify } = setup('ag');
    await provider.get();
    let release: () => void;
    let started: () => void;
    const pendingSearch = new Promise<void>((resolve) => {
      release = resolve;
    });
    const searching = new Promise<void>((resolve) => {
      started = resolve;
    });
    provider.getAckmate = async (filePaths) => {
      started();
      await pendingSearch;
      return [{ filePath: filePaths[0], line: '<!--TODO Previous target-->', lineNr: 0 }];
    };
    notify('change', document.uri.fsPath);
    await searching;
    retargetAlias();
    notify('change', document.uri.fsPath);
    release();
    await provider.dataRefreshQueue;
    expect(Object.keys(provider.filesData)).to.deep.equal([]);
    expect(provider.nonEmptyFiles.size).to.equal(0);
  });

  it('does not enumerate the cache for every excluded watcher event', async () => {
    const { document, changeOnDisk } = setup('js', [workspace]);
    await provider.get();
    fs.mkdirSync(path.join(workspace, 'ignored'));
    document.uri.fsPath = path.join(workspace, 'ignored', 'generated.html');
    fs.writeFileSync(document.uri.fsPath, '');
    const data = {};
    for (let index = 0; index < 5000; index++) {
      data[path.join(workspace, `todo-${index}.html`)] = [];
    }
    let enumerations = 0;
    provider.filesData = new Proxy(data, {
      ownKeys: (target) => {
        enumerations++;
        return Reflect.ownKeys(target);
      },
    });

    for (let index = 0; index < 100; index++) changeOnDisk();
    await provider.dataRefreshQueue;

    expect(enumerations).to.be.at.most(1);
    expect(Object.keys(data)).to.have.length(5000);
  });

  it('keeps one cache entry when an aliased root overlaps a canonical nested root', async () => {
    const nested = path.join(workspace, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'index.html'), '<html>No markers</html>');
    const { document, setContent } = setup('js', [alias, nested]);
    document.uri.fsPath = path.join(nested, 'index.html');
    setContent('<!--TODO Use grid style-->');
    await provider.get();
    provider.updateDocumentData(document);

    expect(Object.keys(provider.filesData).map(path.normalize)).to.deep.equal([
      path.join(alias, 'nested', 'index.html'),
    ]);
  });

  it('still excludes filtered files and symlinks below the workspace root', async () => {
    fs.mkdirSync(path.join(workspace, 'ignored'));
    const ignored = path.join(workspace, 'ignored', 'hidden.html');
    fs.writeFileSync(ignored, '<!--TODO Hidden-->');
    fs.symlinkSync(
      workspace,
      path.join(workspace, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const { document, setContent } = setup('js');
    await provider.get();
    setContent('<!--TODO Hidden-->');

    document.uri.fsPath = ignored;
    expect(provider.updateDocumentData(document)).to.equal(undefined);
    document.uri.fsPath = path.join(alias, 'linked', 'index.html');
    expect(provider.updateDocumentData(document)).to.equal(undefined);
    expect(Object.keys(provider.filesData)).to.deep.equal([]);
  });
});

describe('File service concurrency', () => {
  it('groups folders named after object properties without changing prototypes', () => {
    const files = loadService('../src/utils/files');
    const Abstract = loadService('../src/utils/embedded/providers/abstract');
    const embedded = new Abstract();
    ['constructor', '__proto__'].forEach((root) => {
      const filePath = `/workspace/${root}/tasks.todo`;
      const data = {
        root,
        rootPath: `/workspace/${root}`,
        textEditor: { getText: () => 'todo' },
      };
      files.filesData = { [filePath]: data };
      expect(files.getTodos(false)[root][filePath]).to.equal(data);

      const todo = { root, type: 'TODO', line: 'TODO test', filePath };
      embedded.filesData = { [filePath]: [todo] };
      embedded.nonEmptyFiles = new Set([filePath]);
      expect(embedded.getTodos(true, true, true, false, false)[''].TODO[filePath]).to.deep.equal([
        todo,
      ]);
    });
    expect(Object.prototype).not.to.have.own.property('TODO');
    embedded.dispose();
    files.dispose();
  });

  it('keeps document edits that arrive while a JavaScript scan is pending', async () => {
    const JS = loadService('../src/utils/embedded/providers/js');
    const provider = new JS();
    const filePath = '/workspace/app.ts';
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.getFilePaths = async () => [filePath];
    provider.getFileData = async () => {
      await gate;
      return [{ message: 'old disk todo' }];
    };
    provider.parseContent = (_filePath, content) => [{ message: content }];
    provider.isIncluded = () => true;
    const pending = provider.initFilesData(['/workspace']);
    await Promise.resolve();
    provider.updateDocumentData({
      uri: { scheme: 'file', fsPath: filePath },
      getText: () => 'new unsaved todo',
    });
    release!();
    await pending;
    expect(provider.filesData[filePath]).to.deep.equal([{ message: 'new unsaved todo' }]);
    provider.dispose();
  });

  it('overlays open documents after an external search reads saved content', async () => {
    const AG = loadService('../src/utils/embedded/providers/ag');
    const provider = new AG();
    const filePath = '/workspace/app.ts';
    provider.getFilePaths = async () => [filePath];
    provider.getAckmate = async () => [];
    provider.filterAckmate = (matches) => matches;
    provider.ackmate2data = async () => {
      provider.filesData[filePath] = [{ message: 'saved' }];
    };
    provider.getOpenDocument = () => ({ getText: () => 'unsaved' });
    provider.parseContent = (_filePath, content) => [{ message: content }];
    await provider.initFilesData(['/workspace']);
    expect(provider.filesData[filePath]).to.deep.equal([{ message: 'unsaved' }]);
    expect(provider.nonEmptyFiles.has(filePath)).to.equal(true);
    provider.dispose();
  });

  it('parses bare markers from multiline Liquid comments through the provider path', () => {
    const properties = require('../package.json').contributes.configuration.properties,
      todoEmbedded = new RegExp(
        properties['todo.embedded.regex'].default,
        properties['todo.embedded.regexFlags'].default
      ),
      Abstract = loadService('../src/utils/embedded/providers/abstract', {
        '../../../consts': { default: { regexes: { todoEmbedded } } },
        '../../folder': {
          default: {
            getAllRootPaths: () => ['/workspace'],
            parsePath: () => ({
              root: 'workspace',
              rootPath: '/workspace',
              relativePath: 'template.liquid',
            }),
          },
        },
      }),
      provider = new Abstract();

    provider.getFollowingContext = () => undefined;
    const data = provider.parseContent(
      '/workspace/template.liquid',
      ['{% comment %}', '  TODO: first', '  FIXME: second', '{% endcomment %}'].join('\n')
    );

    expect(
      data.map(({ type, message, lineNr, column }) => ({ type, message, lineNr, column }))
    ).to.deep.equal([
      { type: 'TODO', message: ' first', lineNr: 1, column: 2 },
      { type: 'FIXME', message: ' second', lineNr: 2, column: 2 },
    ]);
    const prefixed = provider.parseContent(
      '/workspace/template.liquid',
      ['{% comment %}', '  // TODO: once', '{% endcomment %}'].join('\n')
    );
    expect(prefixed).to.have.length(1);
    expect(prefixed[0]).to.include({ column: 2, message: ' once' });
    const inline = provider.parseContent(
      '/workspace/template.liquid',
      '{% comment %} TODO: once {% endcomment %}'
    );
    expect(inline).to.have.length(1);
    expect(inline[0]).to.include({ column: 0, message: ' once' });
    provider.dispose();
  });

  it('bounds concurrent Liquid reads by the configured batch size', async () => {
    let active = 0;
    let maximum = 0;
    const AG = loadService('../src/utils/embedded/providers/ag', {
      '../../../config': { default: { get: () => ({ embedded: { batchSize: 2 } }) } },
      '../../file': {
        default: {
          read: async () => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 0));
            active -= 1;
            return 'TODO';
          },
        },
      },
    });
    const provider = new AG();
    provider.filesData = {};
    provider.parseContent = () => [];
    provider.getOpenDocument = () => undefined;
    await provider.loadLiquidFilesData(
      Array.from({ length: 7 }, (_, i) => `/workspace/${i}.liquid`)
    );
    expect(maximum).to.equal(2);
    provider.dispose();
  });

  it('does not read saved Liquid contents over an open document', async () => {
    let reads = 0;
    const AG = loadService('../src/utils/embedded/providers/ag', {
      '../../file': {
        default: {
          read: async () => {
            reads += 1;
            return 'saved';
          },
        },
      },
    });
    const provider = new AG();
    provider.filesData = {};
    provider.getOpenDocument = () => ({ getText: () => 'unsaved' });
    provider.parseContent = (_filePath, content) => [{ message: content }];
    await provider.loadLiquidFilesData(['/workspace/template.liquid']);
    expect(reads).to.equal(0);
    expect(provider.filesData['/workspace/template.liquid']).to.deep.equal([
      { message: 'unsaved' },
    ]);
    provider.dispose();
  });

  it('stops Liquid batches and discards pending reads after disposal', async () => {
    let reads = 0;
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const AG = loadService('../src/utils/embedded/providers/ag', {
      '../../../config': { default: { get: () => ({ embedded: { batchSize: 1 } }) } },
      '../../file': {
        default: {
          read: async () => {
            reads += 1;
            await gate;
            return 'saved';
          },
        },
      },
    });
    const provider = new AG();
    provider.filesData = {};
    provider.getOpenDocument = () => undefined;
    provider.parseContent = (_filePath, content) => [{ message: content }];
    const pending = provider.loadLiquidFilesData(['/workspace/1.liquid', '/workspace/2.liquid']);
    provider.dispose();
    release!();
    await pending;
    expect(reads).to.equal(1);
    expect(provider.filesData).to.deep.equal({});
  });

  it('does not skip Liquid files whose only markers are inside blocks', async () => {
    const JS = loadService('../src/utils/embedded/providers/js', {
        '../../file': { default: { read: async () => 'TODO: inside a Liquid comment block' } },
      }),
      provider = new JS(),
      filePath = '/workspace/template.liquid';

    provider.getOpenDocument = () => undefined;
    provider.parseContent = (parsedPath, content) => [{ filePath: parsedPath, message: content }];

    expect(await provider.getFileData(filePath)).to.deep.equal([
      { filePath, message: 'TODO: inside a Liquid comment block' },
    ]);
    provider.dispose();
  });

  it('fully scans Liquid files when an external search cannot see block contents', async () => {
    const reads: string[] = [],
      AG = loadService('../src/utils/embedded/providers/ag', {
        '../../file': {
          default: {
            read: async (filePath: string) => {
              reads.push(filePath);
              return 'TODO: from a Liquid comment block';
            },
          },
        },
      }),
      provider = new AG(),
      liquidPath = '/workspace/template.liquid',
      sourcePath = '/workspace/app.ts';

    provider.getFilePaths = async () => [liquidPath, sourcePath];
    provider.getAckmate = async () => [];
    provider.filterAckmate = (matches) => matches;
    provider.ackmate2data = async () => undefined;
    provider.getOpenDocument = () => undefined;
    provider.parseContent = (filePath, content) => [{ filePath, message: content }];

    await provider.initFilesData(['/workspace']);

    expect(reads).to.deep.equal([liquidPath]);
    expect(provider.filesData[liquidPath]).to.deep.equal([
      { filePath: liquidPath, message: 'TODO: from a Liquid comment block' },
    ]);
    expect(provider.filesData).to.not.have.property(sourcePath);
    provider.dispose();
  });

  ['files', 'embedded'].forEach((name) => {
    it(`serializes concurrent ${name} scans and installs one set of watchers`, async () => {
      const loaded = loadService(
        name === 'files' ? '../src/utils/files' : '../src/utils/embedded/providers/abstract'
      );
      const service = name === 'files' ? loaded : new loaded();
      let release: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let scans = 0;
      let watches = 0;
      let updates = 0;
      service.initFilesData = async () => {
        scans += 1;
        await gate;
        service.filesData = {};
      };
      service.watchPaths = () => {
        watches += 1;
      };
      service.updateFilesData = async () => {
        updates += 1;
      };
      const first = service.get();
      const second = service.get();
      await Promise.resolve();
      expect(scans).to.equal(1);
      release!();
      await Promise.all([first, second]);
      expect(scans).to.equal(1);
      expect(watches).to.equal(1);
      expect(updates).to.equal(1);
      service.dispose();
    });

    it(`does not reinstall ${name} watchers after disposal during a scan`, async () => {
      const loaded = loadService(
        name === 'files' ? '../src/utils/files' : '../src/utils/embedded/providers/abstract'
      );
      const service = name === 'files' ? loaded : new loaded();
      let release: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let watches = 0;
      service.initFilesData = async () => {
        await gate;
        service.filesData = {};
      };
      service.watchPaths = () => {
        watches += 1;
      };
      const pending = service.get();
      await Promise.resolve();
      service.dispose();
      release!();
      await pending;
      expect(watches).to.equal(0);
    });
  });

  it('shares provider initialization and retries with the current generation after a reset', async () => {
    let instances = 0;
    class Provider {
      constructor() {
        instances += 1;
      }
    }
    const Embedded = loadService('../src/utils/embedded/index', {
      './providers/ag': { default: Provider },
      './providers/js': { default: Provider },
      './providers/rg': { default: Provider },
    });
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detections = 0;
    Embedded.providers.rg = async () => {
      detections += 1;
      await gate;
      return Provider;
    };

    const first = Embedded.initProvider();
    const second = Embedded.initProvider();
    expect(first).to.equal(second);
    expect(detections).to.equal(1);
    Embedded.resetProvider();
    release!();
    await Promise.all([first, second]);
    expect(detections).to.equal(2);
    expect(instances).to.equal(1);
  });

  it('does not allocate a provider after the embedded service is disposed', async () => {
    let instances = 0;
    class Provider {
      constructor() {
        instances += 1;
      }
    }
    const Embedded = loadService('../src/utils/embedded/index', {
      './providers/ag': { default: Provider },
      './providers/js': { default: Provider },
      './providers/rg': { default: Provider },
    });
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Embedded.providers.rg = async () => {
      await gate;
      return Provider;
    };
    const pending = Embedded.initProvider();
    Embedded.dispose();
    release!();
    await pending;
    await Embedded.initProvider();
    expect(instances).to.equal(0);
    expect(Embedded.provider).to.equal(undefined);
  });
});
