import { expect } from 'chai';
import { getEmbeddedDragAndDropOptions } from '../src/utils/embedded/drag-and-drop';

const makeStorage = () => {
  let saved;
  const writes: unknown[] = [];
  return {
    get: () => saved,
    update: async (_key, value) => {
      saved = value;
      writes.push(value);
    },
    writes,
  };
};

const makeTodo = (message: string, lineNr = 0, filePath = '/workspace/app.ts') => ({
  filePath,
  relativePath: filePath.split('/').pop(),
  rootPath: '/workspace',
  type: 'TODO',
  todo: `// TODO ${message}`,
  message,
  line: `// TODO ${message}`,
  lineNr,
  column: 0,
});

const loadView = (tree, storage = makeStorage()) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    modules = [
      'embedded',
      'view',
      'items/item',
      'items/todo',
      'items/group',
      'items/file',
      'items/placeholder',
    ].map((name) => require.resolve(`../src/views/${name}`)),
    previous = modules.map((name) => require.cache[name]);
  const settings = {
    sort: 'manual',
    groupByRoot: true,
    groupByType: true,
    groupByFile: true,
    wholeLine: false,
    showContext: false,
    icons: false,
  };
  const config = { embedded: { view: settings } };
  const provider = { tree, get: async () => provider.tree, filesData: {} };
  const utils = {
    embedded: { initProvider: async () => undefined, provider },
    view: {
      getURI: (todo) => ({ fsPath: todo.filePath, label: todo.relativePath }),
      getTypeIcon: () => undefined,
    },
  };
  const events: unknown[] = [];
  const vscode = {
    version: '1.66.0',
    DataTransferItem: class {
      constructor(public value: unknown) {}
    },
    TreeItem: class {
      constructor(
        public label,
        public collapsibleState
      ) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: { File: 'file' },
    EventEmitter: class {
      event = () => ({ dispose() {} });
      fire(item) {
        events.push(item);
      }
      dispose() {}
    },
    window: { onDidChangeActiveTextEditor: () => ({ dispose() {} }) },
  };
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode') return vscode;
    if (request === '../config') return { default: { get: () => config } };
    if (request === '../utils' || request === '../../utils') return { default: utils };
    return originalLoad(request, parent, isMain);
  };
  try {
    modules.forEach((name) => delete require.cache[name]);
    const view = require('../src/views/embedded').default;
    view.initializeOrder(storage);
    const controller = getEmbeddedDragAndDropOptions(vscode, view).dragAndDropController;
    return { view, settings, provider, storage, events, controller };
  } finally {
    NodeModule._load = originalLoad;
    modules.forEach((name, index) => {
      delete require.cache[name];
      if (previous[index]) require.cache[name] = previous[index];
    });
  }
};

const labels = (items) => items.map((item) => item.label);
const makeToken = () => ({
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
});
const workflow = (rootPath = '/workspace') => ({
  HIGH: { [`${rootPath}/app.ts`]: [{ ...makeTodo('high', 0, `${rootPath}/app.ts`), rootPath }] },
  NEXT: { [`${rootPath}/app.ts`]: [{ ...makeTodo('next', 0, `${rootPath}/app.ts`), rootPath }] },
  NOW: { [`${rootPath}/app.ts`]: [{ ...makeTodo('now', 0, `${rootPath}/app.ts`), rootPath }] },
});

describe('Embedded view manual ordering', () => {
  it('reorders marker groups and restores them in a new view instance', async () => {
    const tree = { '': workflow() },
      state = loadView(tree);
    const groups = await state.view.getChildren();
    await state.view.move(groups[2], -1);
    expect(labels(await state.view.getChildren())).to.deep.equal(['HIGH', 'NOW', 'NEXT']);
    const reloaded = loadView(tree, state.storage);
    expect(labels(await reloaded.view.getChildren())).to.deep.equal(['HIGH', 'NOW', 'NEXT']);
    reloaded.settings.sort = 'label';
    expect(labels(await reloaded.view.getChildren())).to.deep.equal(['HIGH', 'NEXT', 'NOW']);
    reloaded.settings.sort = 'manual';
    expect(labels(await reloaded.view.getChildren())).to.deep.equal(['HIGH', 'NOW', 'NEXT']);
  });

  it('reorders child files and todos while retaining their source navigation', async () => {
    const tree = {
        '': {
          TODO: {
            '/workspace/a.ts': [makeTodo('a', 0, '/workspace/a.ts')],
            '/workspace/b.ts': [
              makeTodo('first', 4, '/workspace/b.ts'),
              makeTodo('second', 8, '/workspace/b.ts'),
            ],
          },
        },
      },
      source = JSON.stringify(tree),
      { view } = loadView(tree);
    let group = (await view.getChildren())[0];
    await view.move((await view.getChildren(group))[1], -1);
    group = (await view.getChildren())[0];
    let files = await view.getChildren(group);
    expect(labels(files)).to.deep.equal(['b.ts', 'a.ts']);
    await view.move((await view.getChildren(files[0]))[1], -1);
    group = (await view.getChildren())[0];
    files = await view.getChildren(group);
    const todos = await view.getChildren(files[0]);
    expect(labels(todos)).to.deep.equal(['second', 'first']);
    expect(todos[0].obj.lineNr).to.equal(8);
    expect(todos[0].command.command).to.equal('todo.viewRevealTodo');
    expect(todos[0].command.arguments[0]).to.equal(todos[0]);
    expect(files[0].resourceUri.fsPath).to.equal('/workspace/b.ts');
    expect(JSON.stringify(tree)).to.equal(source);
  });

  it('keeps todo ranks through a partial file refresh and display changes', async () => {
    const data = [makeTodo('first', 1), makeTodo('second', 5)],
      state = loadView({ '': { '': { '/workspace/app.ts': data } } });
    state.settings.groupByType = false;
    let file = (await state.view.getChildren())[0];
    await state.view.move((await state.view.getChildren(file))[1], -1);
    file = (await state.view.getChildren())[0];
    const updated = data.map((todo) => ({
      ...todo,
      lineNr: todo.lineNr + 10,
      context: 'changed()',
    }));
    state.provider.filesData['/workspace/app.ts'] = updated;
    state.settings.wholeLine = true;
    state.settings.showContext = true;
    state.settings.icons = true;
    await state.view.refreshFile('/workspace/app.ts');
    const todos = await state.view.getChildren(file);
    expect(todos.map((todo) => todo.obj.message)).to.deep.equal(['second', 'first']);
    expect(todos[0].label).to.equal('// TODO second — changed()');
    expect(todos[0].obj.lineNr).to.equal(15);
    expect(state.events[state.events.length - 1]).to.equal(file);
  });

  it('retains a root’s ordering when its previously hidden root node becomes visible', async () => {
    const state = loadView({ '': workflow() });
    await state.view.move((await state.view.getChildren())[2], -1);
    state.provider.tree = { workspace: workflow(), other: workflow('/other') };
    const roots = await state.view.getChildren();
    expect(
      labels(await state.view.getChildren(roots.find((item) => item.label === 'workspace')))
    ).to.deep.equal(['HIGH', 'NOW', 'NEXT']);
    expect(
      labels(await state.view.getChildren(roots.find((item) => item.label === 'other')))
    ).to.deep.equal(['HIGH', 'NEXT', 'NOW']);
  });

  it('does not move hidden siblings, stale nodes, or items outside manual mode', async () => {
    const { view, settings, storage } = loadView({ '': workflow() });
    const groups = await view.getChildren();
    view.filter = 'now';
    await view.move(groups[2], -1);
    view.filter = false;
    view.all = false;
    await view.move(groups[2], -1);
    view.all = true;
    settings.sort = 'label';
    await view.move(groups[2], -1);
    settings.sort = 'manual';
    view.refresh();
    await view.move(groups[2], -1);
    await view.move(undefined, -1);
    expect(storage.writes).to.deep.equal([]);
  });

  it('uses deterministic source positions without file groups, and reset restores them', async () => {
    const data = [makeTodo('z', 8), makeTodo('b', 1), makeTodo('a', 0, '/other/app.ts')],
      state = loadView({ '': { '': { '': data } } });
    state.settings.groupByRoot = state.settings.groupByType = state.settings.groupByFile = false;
    const todos = await state.view.getChildren();
    expect(labels(todos)).to.deep.equal(['a', 'b', 'z']);
    await state.view.move(todos[2], -1);
    expect(labels(await state.view.getChildren())).to.deep.equal(['a', 'z', 'b']);
    await state.view.resetOrder();
    expect(labels(await state.view.getChildren())).to.deep.equal(['a', 'b', 'z']);
  });

  it('preserves existing line/label behavior and saved ranks when modes change', async () => {
    const data = [makeTodo('z', 1), makeTodo('a', 2)],
      state = loadView({ '': { '': { '': data } } });
    await state.view.move((await state.view.getChildren())[1], -1);
    state.settings.sort = 'line';
    expect(labels(await state.view.getChildren())).to.deep.equal(['z', 'a']);
    state.settings.sort = 'label';
    expect(labels(await state.view.getChildren())).to.deep.equal(['a', 'z']);
    state.settings.sort = 'manual';
    expect(labels(await state.view.getChildren())).to.deep.equal(['a', 'z']);
  });

  it('ignores moves when the last sibling disappears before the action runs', async () => {
    const state = loadView({ '': workflow() });
    const groups = await state.view.getChildren();
    state.provider.tree = {};
    await state.view.move(groups[0], 1);
    expect(state.storage.writes).to.deep.equal([]);
  });

  it('persists group drops through the drag controller and remains compatible with move commands', async () => {
    const tree = { '': workflow() },
      source = JSON.stringify(tree),
      state = loadView(tree);
    const groups = await state.view.getChildren(),
      transfer = new Map(),
      token = makeToken();
    state.controller.handleDrag([groups[2]], transfer, token);
    await state.controller.handleDrop(groups[0], transfer, token);
    expect(labels(await state.view.getChildren())).to.deep.equal(['NOW', 'HIGH', 'NEXT']);
    const reloaded = loadView(tree, state.storage);
    const restored = await reloaded.view.getChildren();
    expect(labels(restored)).to.deep.equal(['NOW', 'HIGH', 'NEXT']);
    await reloaded.view.move(restored[0], 1);
    expect(labels(await reloaded.view.getChildren())).to.deep.equal(['HIGH', 'NOW', 'NEXT']);
    expect(JSON.stringify(tree)).to.equal(source);
  });

  it('reorders sibling files and tasks without moving tasks to a different parent', async () => {
    const tree = {
        '': {
          TODO: {
            '/workspace/a.ts': [makeTodo('a', 0, '/workspace/a.ts')],
            '/workspace/b.ts': [
              makeTodo('first', 4, '/workspace/b.ts'),
              makeTodo('second', 8, '/workspace/b.ts'),
            ],
          },
        },
      },
      state = loadView(tree),
      token = makeToken();
    let group = (await state.view.getChildren())[0],
      files = await state.view.getChildren(group);
    const firstFileTodos = await state.view.getChildren(files[0]),
      secondFileTodos = await state.view.getChildren(files[1]);
    await state.view.drop(firstFileTodos[0], secondFileTodos[0], token);
    await state.view.drop(group, files[0], token);
    expect(state.storage.writes).to.deep.equal([]);
    await state.view.drop(files[0], files[1], token);
    group = (await state.view.getChildren())[0];
    files = await state.view.getChildren(group);
    expect(labels(files)).to.deep.equal(['b.ts', 'a.ts']);
    const tasks = await state.view.getChildren(files[0]);
    await state.view.drop(tasks[0], tasks[1], token);
    group = (await state.view.getChildren())[0];
    files = await state.view.getChildren(group);
    const reordered = await state.view.getChildren(files[0]);
    expect(labels(reordered)).to.deep.equal(['second', 'first']);
    expect(reordered[0].obj.lineNr).to.equal(8);
  });

  it('rejects self, foreign, cancelled, filtered, active-file, automatic-mode, and stale drops', async () => {
    const state = loadView({ '': workflow() }),
      token = makeToken();
    const groups = await state.view.getChildren();
    expect(state.view.canDrag(groups[0])).to.equal(true);
    await state.view.drop(groups[0], groups[0], token);
    await state.view.drop({}, groups[0], token);
    token.isCancellationRequested = true;
    await state.view.drop(groups[0], groups[1], token);
    token.isCancellationRequested = false;
    state.view.filter = 'NOW';
    expect(state.view.canDrag(groups[0])).to.equal(false);
    await state.view.drop(groups[0], groups[1], token);
    state.view.filter = false;
    state.view.all = false;
    await state.view.drop(groups[0], groups[1], token);
    state.view.all = true;
    state.settings.sort = 'label';
    await state.view.drop(groups[0], groups[1], token);
    state.settings.sort = 'manual';
    state.view.refresh();
    expect(state.view.canDrag(groups[0])).to.equal(false);
    await state.view.drop(groups[0], groups[1], token);
    expect(state.storage.writes).to.deep.equal([]);
  });

  it('honors cancellation while sibling data is being refreshed for a drop', async () => {
    const state = loadView({ '': workflow() }),
      token = makeToken();
    const groups = await state.view.getChildren();
    state.provider.get = async () => {
      token.isCancellationRequested = true;
      return state.provider.tree;
    };
    await state.view.drop(groups[0], groups[1], token);
    expect(state.storage.writes).to.deep.equal([]);
  });
});
