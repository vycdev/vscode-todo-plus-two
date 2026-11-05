import { expect } from 'chai';

const loadDependencyIndex = (vscodeStub) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    dependencyIndexPath = require.resolve('../src/utils/dependency_index'),
    previousDependencyIndex = require.cache[dependencyIndexPath];

  NodeModule._load = function (request: string, parent, isMain: boolean) {
    if (request === 'vscode') return vscodeStub;
    if (parent && parent.filename.replace(/\\/g, '/').endsWith('/dependency_index.ts')) {
      if (request === '../consts') {
        return { default: { languageId: 'todo', regexes: { todo: /^\s*☐/ } } };
      }
      if (request === './files') return { default: { getDocuments: async () => ({}) } };
      if (request === './folder') return { default: { getAllRootPaths: () => [] } };
      if (request === './regex') {
        return { default: { test: (regex: RegExp, text: string) => regex.test(text) } };
      }
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[dependencyIndexPath];
    return require('../src/utils/dependency_index').default;
  } finally {
    NodeModule._load = originalLoad;
    if (previousDependencyIndex) {
      require.cache[dependencyIndexPath] = previousDependencyIndex;
    } else {
      delete require.cache[dependencyIndexPath];
    }
  }
};

const vscodeStub = {
  workspace: {
    textDocuments: [],
    workspaceFolders: [],
  },
};

describe('Dependency index task data flow', () => {
  it('ignores IDs and references in fenced task examples', async () => {
    const DependencyIndex = loadDependencyIndex(vscodeStub);
    const lines = ['```ts', '☐ example @id(fake) @depends(fake)', '```', '☐ real @id(real)'];
    const document = {
      languageId: 'todo',
      uri: { toString: () => 'file:///workspace/TODO', fsPath: '/workspace/TODO' },
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line] }),
    } as any;
    vscodeStub.workspace.textDocuments = [document];
    const index = await DependencyIndex.get(document);
    expect(Object.keys(index.targets)).to.deep.equal(['real']);
    expect(Object.keys(index.dependencies)).to.deep.equal([]);
    expect(index.targets.real[0].lineNumber).to.equal(3);
  });
  it('indexes IDs that collide with Object prototype properties', async () => {
    const DependencyIndex = loadDependencyIndex(vscodeStub),
      ids = ['__proto__', 'constructor', 'toString'],
      lines = ids.map((id) => `  ☐ Task @id(${id}) @depends(${id})`),
      document = {
        languageId: 'todo',
        uri: {
          toString: () => 'file:///workspace/TODO',
          fsPath: '/workspace/TODO',
        },
        lineCount: lines.length,
        lineAt: (lineNumber: number) => ({ text: lines[lineNumber] }),
      } as any;

    vscodeStub.workspace.textDocuments = [document];

    const index = await DependencyIndex.get(document);

    expect(Object.keys(index.targets)).to.deep.equal(ids);
    ids.forEach((id, lineNumber) => {
      expect(index.targets[id][0].lineNumber).to.equal(lineNumber);
      expect(index.dependencies[id][0].lineNumber).to.equal(lineNumber);
    });
  });

  it('does not treat comment references as task IDs or dependencies', async () => {
    const DependencyIndex = loadDependencyIndex(vscodeStub),
      lines = [
        '  ☐ Publish API contract @id(api-contract)',
        '  - explanatory note @id(note-only) @depends(api-contract)',
        '  ☐ Integrate the API @depends(api-contract)',
      ],
      document = {
        languageId: 'todo',
        uri: {
          toString: () => 'file:///workspace/TODO',
          fsPath: '/workspace/TODO',
        },
        lineCount: lines.length,
        lineAt: (lineNumber: number) => ({ text: lines[lineNumber] }),
      } as any;

    vscodeStub.workspace.textDocuments = [document];

    const index = await DependencyIndex.get(document);

    expect(index.targets).to.have.all.keys('api-contract');
    expect(index.dependencies).to.have.all.keys('api-contract');
    expect(index.dependencies['api-contract']).to.have.length(1);
    expect(index.dependencies['api-contract'][0].lineNumber).to.equal(2);
  });
});
