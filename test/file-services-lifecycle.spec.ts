import { expect } from 'chai';

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
