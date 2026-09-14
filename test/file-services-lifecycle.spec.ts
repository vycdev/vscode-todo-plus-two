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
