import { expect } from 'chai';

describe('Embedded snapshot editor', () => {
  it('opens a populated untitled document and returns the displayed editor', async () => {
    const NodeModule = require('module');
    const originalLoad = NodeModule._load;
    const modulePath = require.resolve('../src/utils/editor');
    const previous = require.cache[modulePath];
    const opened: any[] = [];
    const shown: any[] = [];
    const document = { getText: () => '☐ Embedded task' };
    const textEditor = { document };
    NodeModule._load = (request, parent, isMain) => {
      if (parent.filename === modulePath) {
        if (request === '../consts') return { default: { languageId: 'todo' } };
        if (request === 'vscode')
          return {
            workspace: {
              openTextDocument: async (options) => {
                opened.push(options);
                return document;
              },
            },
            window: {
              showTextDocument: async (...args) => {
                shown.push(args);
                return textEditor;
              },
            },
          };
      }
      return originalLoad(request, parent, isMain);
    };
    let editor;
    try {
      delete require.cache[modulePath];
      editor = require(modulePath).default;
    } finally {
      NodeModule._load = originalLoad;
      if (previous) require.cache[modulePath] = previous;
      else delete require.cache[modulePath];
    }
    expect(await editor.open('☐ Embedded task')).to.equal(textEditor);
    expect(opened).to.deep.equal([{ language: 'todo', content: '☐ Embedded task' }]);
    expect(shown).to.deep.equal([[document, { preview: false }]]);
  });
});
