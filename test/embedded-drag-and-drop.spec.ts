import { expect } from 'chai';
import { getEmbeddedDragAndDropOptions } from '../src/utils/embedded/drag-and-drop';

const runtime = {
  version: '1.66.0',
  DataTransferItem: class {
    constructor(public value: unknown) {}
    async asString() {
      return typeof this.value === 'string' ? this.value : JSON.stringify(this.value);
    }
  },
};

const makeToken = () => ({
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
});

describe('Embedded tree drag and drop', () => {
  it('uses a serializable payload for circular tree items and passes the original node to the view', async () => {
    const source: any = {},
      target = {},
      calls: unknown[] = [];
    source.command = { arguments: [source] };
    const view = {
      canDrag: (item) => item === source,
      drop: async (...args) => {
        calls.push(args);
      },
    };
    const controller = getEmbeddedDragAndDropOptions(runtime, view).dragAndDropController,
      transfer = new Map(),
      token = makeToken();
    expect(controller.dropMimeTypes).to.include('application/vnd.code.tree.todo.views.2embedded');
    controller.handleDrag([source], transfer, token);
    const payload = transfer.get(controller.dropMimeTypes[0]);
    expect(payload.value).not.to.equal(source);
    expect(await payload.asString()).to.equal('{}');
    expect(controller.dragMimeTypes).to.deep.equal([]);
    await controller.handleDrop(target, transfer, token);
    expect(calls).to.deep.equal([[source, target, token]]);
  });

  it('rejects payloads from other controllers and completed drag operations', async () => {
    const calls: unknown[] = [];
    const controller = getEmbeddedDragAndDropOptions(runtime, {
      canDrag: () => true,
      drop: async (...args) => {
        calls.push(args);
      },
    }).dragAndDropController;
    const transfer = new Map(),
      foreign = new Map(),
      token = makeToken();
    controller.handleDrag([{}], transfer, token);
    foreign.set(controller.dropMimeTypes[0], new runtime.DataTransferItem({}));
    await controller.handleDrop({}, foreign, token);
    await controller.handleDrop({}, transfer, token);
    expect(calls).to.deep.equal([]);
    controller.handleDrag([{}], transfer, token);
    await controller.handleDrop({}, transfer, token);
    await controller.handleDrop({}, transfer, token);
    expect(calls).to.have.length(1);
  });

  it('does not start unavailable, cancelled, empty, or multi-item drags', () => {
    let enabled = false;
    const controller = getEmbeddedDragAndDropOptions(runtime, {
      canDrag: () => enabled,
      drop: async () => undefined,
    }).dragAndDropController;
    const transfer = new Map(),
      token = makeToken();
    controller.handleDrag([{}], transfer, token);
    enabled = true;
    controller.handleDrag([], transfer, token);
    controller.handleDrag([{}, {}], transfer, token);
    token.isCancellationRequested = true;
    controller.handleDrag([{}], transfer, token);
    expect(transfer.size).to.equal(0);
  });

  it('ignores missing payloads, background drops, and cancelled drops', async () => {
    const calls: unknown[] = [];
    const controller = getEmbeddedDragAndDropOptions(runtime, {
      canDrag: () => true,
      drop: async (...args) => {
        calls.push(args);
      },
    }).dragAndDropController;
    const transfer = new Map(),
      token = makeToken();
    await controller.handleDrop({}, transfer, token);
    controller.handleDrag([{}], transfer, token);
    await controller.handleDrop(undefined, transfer, token);
    token.isCancellationRequested = true;
    await controller.handleDrop({}, transfer, token);
    expect(calls).to.deep.equal([]);
  });

  it('preserves older VS Code compatibility and recognizes stable and insiders support', () => {
    const view = { canDrag: () => true, drop: async () => undefined };
    for (const version of ['1.36.0', '1.65.2', 'unknown']) {
      expect(getEmbeddedDragAndDropOptions({ ...runtime, version }, view)).to.deep.equal({});
    }
    expect(getEmbeddedDragAndDropOptions({ version: '1.66.0' }, view)).to.deep.equal({});
    for (const version of ['1.66.0', '1.66.0-insider', '1.100.0', '2.0.0']) {
      expect(getEmbeddedDragAndDropOptions({ ...runtime, version }, view).dragAndDropController).to
        .exist;
    }
  });
});

describe('Embedded drag-and-drop registration', () => {
  it('attaches the controller only to the Embedded view and leaves older hosts unchanged', () => {
    const NodeModule = require('module'),
      originalLoad = NodeModule._load,
      modulePath = require.resolve('../src/utils/init'),
      previous = require.cache[modulePath];
    const embedded = {
        id: 'embedded',
        canDrag: () => true,
        drop: async () => undefined,
        refresh() {},
      },
      files = { id: 'files', refresh() {} },
      due = { id: 'due', refresh() {} },
      registrations: { id: string; options: any }[] = [];
    const vscode = {
      ...runtime,
      window: {
        createTreeView: (id, options) => {
          registrations.push({ id, options });
          return { dispose() {} };
        },
      },
      workspace: { onDidChangeConfiguration: () => ({ dispose() {} }) },
    };
    const mocks = {
      vscode,
      '../consts': {},
      '../config': {},
      '../views': { default: [files, embedded, due] },
      '../views/embedded': { default: embedded },
    };
    NodeModule._load = (request, parent, isMain) =>
      parent && parent.filename === modulePath && mocks[request]
        ? mocks[request]
        : originalLoad(request, parent, isMain);
    try {
      delete require.cache[modulePath];
      const init = require(modulePath).default;
      init.views({ subscriptions: [] });
      expect(
        registrations.map(({ id, options }) => [id, !!options.dragAndDropController])
      ).to.deep.equal([
        ['files', false],
        ['embedded', true],
        ['due', false],
      ]);
      registrations.forEach(({ id, options }) => expect(options.treeDataProvider.id).to.equal(id));
      registrations.length = 0;
      vscode.version = '1.36.0';
      init.views({ subscriptions: [] });
      expect(registrations.every(({ options }) => !options.dragAndDropController)).to.equal(true);
    } finally {
      NodeModule._load = originalLoad;
      delete require.cache[modulePath];
      if (previous) require.cache[modulePath] = previous;
    }
  });
});
