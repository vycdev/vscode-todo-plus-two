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
  const window = { activeTextEditor: editor, visibleTextEditors: [editor] };
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
      this.textEditor = res.document
        ? res
        : window.visibleTextEditors.find((editor) => editor.document === res);
      this.textDocument = res.document || res;
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
    if (request === './task-tags')
      return { getTaskTagDecorations: () => [], disposeTaskTagDocument() {} };
    if (request === '../../statusbars/timer')
      return { default: { update: (doc) => timerDocuments.push(doc && doc.textDocument) } };
    if (request === '../../statusbars/statistics')
      return { default: { update: () => statisticsUpdates.push(tokens.global) } };
    if (/^\.\/(comment|formatted|project|tag|todo_due)$/.test(request)) {
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
  it('refreshes both split views of an edited document without touching other documents', () => {
    withDecorator(({ decorator, editor, window, setText }) => {
      const applied = [];
      const split = { ...editor, setDecorations: (type, ranges) => applied.push({ type, ranges }) };
      const unrelated = {
        ...split,
        document: { getText: () => 'other', tokens: { pending: 2 } },
        setDecorations: () => {
          throw new Error('Unrelated editor was decorated');
        },
      };
      window.visibleTextEditors.push(split, unrelated);
      const initial = {},
        updated = {};
      decorator.getItemsDecorations = () => [{ type: initial, ranges: ['original'] }];
      decorator.update(split);
      decorator.getItemsDecorations = () => [{ type: updated, ranges: ['changed'] }];
      setText('task @review');
      decorator.updateLines(editor.document, [0]);
      expect(applied).to.deep.equal([
        { type: initial, ranges: ['original'] },
        { type: updated, ranges: ['changed'] },
      ]);
    });
  });

  it('clears its decorations when task support is disabled for an editor', () => {
    withDecorator(({ decorator, editor }) => {
      const type = {};
      const applied = [];
      decorator.getItemsDecorations = () => [{ type, ranges: ['decoration'] }];
      editor.setDecorations = (kind, ranges) => applied.push({ kind, ranges });
      decorator.update(editor);
      editor.supported = false;
      decorator.update(editor);
      expect(applied).to.deep.equal([
        { kind: type, ranges: ['decoration'] },
        { kind: type, ranges: [] },
      ]);
    });
  });
  it('clears decorations in every split when task support is disabled', () => {
    withDecorator(({ decorator, editor, window }) => {
      const applied = [];
      const split = { ...editor, setDecorations: (_type, ranges) => applied.push(ranges) };
      window.visibleTextEditors.push(split);
      decorator.getItemsDecorations = () => [{ type: {}, ranges: ['original'] }];
      decorator.update(editor);
      editor.supported = false;
      split.supported = false;
      decorator.update(editor.document);
      expect(applied).to.deep.equal([['original'], []]);
    });
  });
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
