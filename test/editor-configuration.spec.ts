import { expect } from 'chai';

const loadSettingReader = (version: string) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve('../src/utils/editor-configuration');
  const previous = require.cache[modulePath];
  const base = { folding: true, foldingStrategy: 'auto', tabSize: 4 };
  const overrides: { [key: string]: any } = {};
  const document = { uri: {}, languageId: 'todo' };
  const scopes: any[] = [];
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode' && parent.filename === modulePath)
      return {
        version,
        workspace: {
          getConfiguration: (section, scope) => {
            scopes.push(scope);
            return {
              get: (key) => {
                if (!section) {
                  expect(key).to.equal('[todo]');
                  return overrides;
                }
                const fullKey = `editor.${key}`;
                return scope.languageId && fullKey in overrides ? overrides[fullKey] : base[key];
              },
            };
          },
        },
      };
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[modulePath];
    const { getEditorSetting } = require(modulePath);
    return {
      base,
      overrides,
      scopes,
      document,
      read: (key: string) => getEditorSetting(document, key),
    };
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

describe('Document editor configuration', () => {
  it('uses a resource and language scope on VS Code 1.42 and newer', () => {
    ['1.42.0', '1.143.1', '2.0.0'].forEach((version) => {
      const state = loadSettingReader(version);
      state.overrides['editor.foldingStrategy'] = 'indentation';
      state.overrides['editor.folding'] = false;
      state.overrides['editor.tabSize'] = 2;
      expect(state.read('foldingStrategy')).to.equal('indentation');
      expect(state.read('folding')).to.equal(false);
      expect(state.read('tabSize')).to.equal(2);
      expect(state.scopes).to.deep.equal([state.document, state.document, state.document]);
    });
  });

  it('reads merged language overrides on older supported hosts without passing a newer scope', () => {
    ['1.36.0', '1.41.3'].forEach((version) => {
      const state = loadSettingReader(version);
      state.overrides['editor.folding'] = false;
      state.overrides['editor.foldingStrategy'] = 'indentation';
      expect(state.read('folding')).to.equal(false);
      expect(state.read('foldingStrategy')).to.equal('indentation');
      expect(state.read('tabSize')).to.equal(4);
      expect(state.scopes.every((scope) => scope === state.document.uri)).to.equal(true);
    });
  });
});
