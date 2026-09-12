import { expect } from 'chai';

const withDecorator = (run) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    subjectPath = require.resolve('../src/todo/decorators/document'),
    previous = require.cache[subjectPath];
  let text = 'task @est(10m)';
  const timerDocuments = [];
  const statisticsUpdates = [];
  const textDocument = { getText: () => text, tokens: { pending: 1 } };
  const editor = { document: textDocument, supported: true, setDecorations: () => undefined };
  const window = { activeTextEditor: editor };
  const tokens = {
    global: {},
    updateGlobal: (items) => {
      tokens.global = items.tokens;
    },
  };
  const settings = { statistics: true };
  class Document {
    textDocument;
    textEditor;
    constructor(res) {
      this.textEditor = res;
      this.textDocument = res.document;
    }
    isSupported() {
      return this.textEditor.supported;
    }
  }
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode') return { window };
    if (request === '../../config')
      return {
        default: {
          getKey: (key) => key === 'statistics.statusbar.enabled' && settings.statistics,
        },
      };
    if (request === '../../utils')
      return {
        default: {
          editor: { isSupported: (item) => item && item.supported },
          statistics: { tokens },
        },
      };
    if (request === '../document') return { default: Document };
    if (request === '../../statusbars/timer')
      return { default: { update: (doc) => timerDocuments.push(doc && doc.textDocument) } };
    if (request === '../../statusbars/statistics')
      return { default: { update: () => statisticsUpdates.push(tokens.global) } };
    if (
      /^\.\/(comment|formatted|project|tag|todo_due|todo_done|todo_cancelled|todo_started)$/.test(
        request
      )
    ) {
      return { default: class Decorator {} };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[subjectPath];
    const decorator = require(subjectPath).default;
    decorator.getItems = (doc) => ({ tokens: doc.textDocument.tokens });
    decorator.getItemsDecorations = () => [];
    run({
      decorator,
      editor,
      window,
      settings,
      timerDocuments,
      statisticsUpdates,
      setText: (value) => {
        text = value;
      },
    });
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    if (previous) require.cache[subjectPath] = previous;
  }
};

describe('Document decoration refresh', () => {
  it('updates derived task state when tag edits keep the same length', () => {
    withDecorator(({ decorator, editor, setText, timerDocuments }) => {
      decorator.update(editor);
      setText('task @est(20m)');
      decorator.updateLines(editor, [0]);
      expect(timerDocuments).to.have.length(2);
      decorator.updateLines(editor, [0]);
      expect(timerDocuments).to.have.length(2);
    });
  });

  it('keeps status bars on the active document while a background editor changes', () => {
    withDecorator(({ decorator, editor, timerDocuments, statisticsUpdates }) => {
      decorator.update(editor);
      decorator.update({
        supported: true,
        setDecorations: () => undefined,
        document: {
          getText: () => 'background task',
          tokens: { pending: 10 },
        },
      });

      expect(timerDocuments).to.deep.equal([editor.document]);
      expect(statisticsUpdates).to.deep.equal([{ pending: 1 }, { pending: 1 }]);
    });
  });

  it('refreshes hidden statusbar settings and clears timers outside Todo editors', () => {
    withDecorator(({ decorator, editor, window, settings, timerDocuments, statisticsUpdates }) => {
      decorator.update(editor);
      settings.statistics = false;
      window.activeTextEditor = undefined;
      decorator.update();

      expect(timerDocuments).to.deep.equal([editor.document, undefined]);
      expect(statisticsUpdates).to.have.length(2);
    });
  });
});
