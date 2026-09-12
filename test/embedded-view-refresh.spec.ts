import { expect } from 'chai';

const loadEmbeddedView = () => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    subjectPath = require.resolve('../src/views/embedded'),
    previous = require.cache[subjectPath];
  const viewSettings = { groupByType: false };
  const provider = { filesData: { '/workspace/code.ts': [{ todo: 'TODO' }, { todo: 'FIXME' }] } };
  class View {
    subscriptions = [];
    config = { embedded: { view: viewSettings } };
    rootRefreshes = 0;
    itemRefreshes = [];
    onDidChangeTreeDataEvent = { fire: (item) => this.itemRefreshes.push(item) };
    refresh() {
      this.rootRefreshes++;
    }
  }
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode')
      return { window: { onDidChangeActiveTextEditor: () => ({ dispose() {} }) } };
    if (request === '../utils')
      return { default: { embedded: { initProvider: async () => undefined, provider } } };
    if (request === './view') return { default: View };
    if (request.startsWith('./items/')) return { default: class Item {} };
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[subjectPath];
    return { view: require(subjectPath).default, viewSettings, provider };
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    if (previous) require.cache[subjectPath] = previous;
  }
};

describe('Embedded view file refresh', () => {
  for (const mode of ['filter', 'groupByType', 'activeFile']) {
    it(`rebuilds grouped or filtered ancestors after edits in ${mode} mode`, async () => {
      const { view, viewSettings } = loadEmbeddedView();
      const fileItem = { obj: [{ todo: 'TODO' }] };
      view.fileItems.set('/workspace/code.ts', fileItem);
      if (mode === 'filter') view.filter = 'TODO';
      if (mode === 'groupByType') viewSettings.groupByType = true;
      if (mode === 'activeFile') view.all = false;

      await view.refreshFile('/workspace/code.ts');
      expect(view.rootRefreshes).to.equal(1);
      expect(view.itemRefreshes).to.deep.equal([]);
    });
  }

  it('refreshes an individual file when its ancestors cannot change', async () => {
    const { view, provider } = loadEmbeddedView();
    const fileItem = { obj: [] };
    view.fileItems.set('/workspace/code.ts', fileItem);
    await view.refreshFile('/workspace/code.ts');

    expect(fileItem.obj).to.equal(provider.filesData['/workspace/code.ts']);
    expect(view.itemRefreshes).to.deep.equal([fileItem]);
    expect(view.rootRefreshes).to.equal(0);
  });
});
