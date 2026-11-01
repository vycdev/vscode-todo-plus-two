import { expect } from 'chai';
import { getNumberedListEnterEdits } from '../src/utils/numbered-list';
import { getCodeBlocks } from '../src/utils/code-blocks';

const pkg = require('../package.json');

const loadCommand = (initialText = '1. First\n2. Second', eol = '\n') => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve('../src/commands');
  const previous = require.cache[modulePath];
  const calls: any[] = [];
  const batches: any[][] = [];
  const state = {
    text: initialText,
    enabled: pkg.contributes.configuration.properties['todo.autoRenumber'].default,
    apply: true,
    isTodo: (text: string) => /^[ \t]*(?:☐|✔|✘|- \[[ xX]\])\s/m.test(text),
  };

  class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  }

  class Selection {
    constructor(
      public anchor: Position,
      public active: Position
    ) {}
    get isEmpty() {
      return (
        this.anchor.line === this.active.line && this.anchor.character === this.active.character
      );
    }
  }

  class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number
    ) {}
  }

  const document = {
    languageId: 'todo',
    version: 1,
    eol: eol === '\r\n' ? 2 : 1,
    get lineCount() {
      return state.text.split(eol).length;
    },
    lineAt: (line: number) => ({ text: state.text.split(eol)[line] }),
  };
  const caret = new Position(0, document.lineAt(0).text.length);
  const selection = new Selection(caret, caret);
  const editor = {
    document,
    selections: [selection],
    selection,
    async edit(callback) {
      const edits = [];
      callback({
        replace: (range, text) => edits.push({ range, text }),
        insert: (position, text) =>
          edits.push({
            range: new Range(position.line, position.character, position.line, position.character),
            text,
            insertion: true,
          }),
      });
      batches.push(edits);
      if (!state.apply) return false;

      const lines = state.text.split(eol);
      edits
        .slice()
        .reverse()
        .forEach(({ range, text }) => {
          lines[range.startLine] =
            lines[range.startLine].slice(0, range.startCharacter) +
            text +
            lines[range.endLine].slice(range.endCharacter);
        });
      state.text = lines.join(eol);
      document.version++;
      return true;
    },
  };
  const vscode = {
    window: { activeTextEditor: editor },
    commands: { executeCommand: async (...args) => calls.push(args) },
    EndOfLine: { LF: 1, CRLF: 2 },
    Position,
    Selection,
    Range,
  };
  const mocks = {
    './utils/code-blocks': { getCodeBlocks },
    './config': { default: { getKey: () => state.enabled } },
    './consts': { default: { languageId: 'todo' } },
    './todo/items': {
      Todo: { is: (text) => state.isTodo(text) },
      Project: { is: (text) => /:\s*(?:@.*)?$/.test(text) },
    },
    './utils/numbered-list': { getNumberedListEnterEdits },
  };
  NodeModule._load = (request, parent, isMain) => {
    if (parent && parent.filename === modulePath) {
      if (request === 'vscode') return vscode;
      if (mocks[request]) return mocks[request];
      if (request.startsWith('.')) return {};
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[modulePath];
    const { numberedListEnter } = require(modulePath);
    return { numberedListEnter, editor, state, batches, calls, vscode, Position, Selection };
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

describe('Numbered list Enter command', () => {
  it('preserves numbered examples inside fenced code', async () => {
    const loaded = loadCommand('```text\n1. Example\n2. Leave alone\n```');
    const caret = new loaded.Position(1, loaded.editor.document.lineAt(1).text.length);
    loaded.editor.selection.active = caret;
    loaded.editor.selection.anchor = caret;
    await loaded.numberedListEnter();
    expect(loaded.batches).to.deep.equal([]);
    expect(loaded.calls).to.deep.equal([['type', { text: '\n' }]]);
    expect(loaded.state.text).to.equal('```text\n1. Example\n2. Leave alone\n```');
  });
  it('continues and renumbers in one edit using cursor-tracking insertion', async () => {
    const loaded = loadCommand();
    await loaded.numberedListEnter();

    expect(loaded.state.text).to.equal('1. First\n2. \n3. Second');
    expect(loaded.batches.length).to.equal(1);
    expect(loaded.batches[0][0].insertion).to.equal(true);
    expect(loaded.calls).to.deep.equal([]);
  });

  it('uses the document line endings', async () => {
    const loaded = loadCommand('1. First\r\n2. Second', '\r\n');
    await loaded.numberedListEnter();
    expect(loaded.state.text).to.equal('1. First\r\n2. \r\n3. Second');
  });

  it('exits an empty item without inserting another line', async () => {
    const loaded = loadCommand('  2. ');
    await loaded.numberedListEnter();
    expect(loaded.state.text).to.equal('  ');
  });

  const fallbacks = {
    'disabled setting': (loaded) => (loaded.state.enabled = false),
    'another language': (loaded) => (loaded.editor.document.languageId = 'markdown'),
    'no active editor': (loaded) => (loaded.vscode.window.activeTextEditor = undefined),
    'middle of an item': (loaded) => (loaded.editor.selection.active.character = 4),
    'selected text': (loaded) => (loaded.editor.selection.anchor = new loaded.Position(0, 0)),
    'multiple cursors': (loaded) => loaded.editor.selections.push(loaded.editor.selection),
  };
  Object.keys(fallbacks).forEach((name) => {
    it(`keeps normal Enter behavior for ${name}`, async () => {
      const loaded = loadCommand();
      fallbacks[name](loaded);
      await loaded.numberedListEnter();
      expect(loaded.batches).to.deep.equal([]);
      expect(loaded.calls).to.deep.equal([['type', { text: '\n' }]]);
    });
  });

  ['☐ Task', '- [ ] Task', 'Project:', '1. Numbered project:', 'A note'].forEach((text) => {
    it(`keeps language Enter rules for ${JSON.stringify(text)}`, async () => {
      const loaded = loadCommand(text);
      await loaded.numberedListEnter();
      expect(loaded.batches).to.deep.equal([]);
      expect(loaded.calls).to.deep.equal([['type', { text: '\n' }]]);
    });
  });

  it('does not renumber numeric custom Todo symbols', async () => {
    const loaded = loadCommand('1. Custom Todo');
    loaded.state.isTodo = (text) => text.startsWith('1. ');
    await loaded.numberedListEnter();
    expect(loaded.batches).to.deep.equal([]);
    expect(loaded.calls).to.deep.equal([['type', { text: '\n' }]]);
  });

  it('does not insert a marker that matches a custom Todo symbol', async () => {
    const loaded = loadCommand('1. A note');
    loaded.state.isTodo = (text) => /^2\.\s/m.test(text);
    await loaded.numberedListEnter();
    expect(loaded.batches).to.deep.equal([]);
    expect(loaded.calls).to.deep.equal([['type', { text: '\n' }]]);
  });

  it('does not turn a following note into a Todo by renumbering it', async () => {
    const loaded = loadCommand('1. First\n2. Second\n3. Last @id(note)');
    loaded.state.isTodo = (text) => /^4\.\s/m.test(text);
    await loaded.numberedListEnter();
    expect(loaded.batches).to.deep.equal([]);
    expect(loaded.state.text).to.equal('1. First\n2. Second\n3. Last @id(note)');
    expect(loaded.calls).to.deep.equal([['type', { text: '\n' }]]);
  });

  it('stops before a following item recognized as a custom Todo', async () => {
    const loaded = loadCommand('1. First\n2. Second\n4. Custom Todo\n5. Leave alone');
    loaded.state.isTodo = (text) => text.startsWith('4. ');
    await loaded.numberedListEnter();
    expect(loaded.state.text).to.equal('1. First\n2. \n3. Second\n4. Custom Todo\n5. Leave alone');
  });

  it('stops before a numbered project heading', async () => {
    const loaded = loadCommand('1. First\n2. Second\n3. Project: @tag\n4. Leave alone');
    await loaded.numberedListEnter();
    expect(loaded.state.text).to.equal(
      '1. First\n2. \n3. Second\n3. Project: @tag\n4. Leave alone'
    );
  });

  it('leaves the caret alone when the editor rejects the edit', async () => {
    const loaded = loadCommand();
    const selection = loaded.editor.selection;
    loaded.state.apply = false;
    await loaded.numberedListEnter();
    expect(loaded.state.text).to.equal('1. First\n2. Second');
    expect(loaded.editor.selection).to.equal(selection);
    expect(loaded.calls).to.deep.equal([]);
  });

  it('enables numbering by default and guards the Enter binding', () => {
    expect(pkg.contributes.configuration.properties['todo.autoRenumber'].default).to.equal(true);
    const binding = pkg.contributes.keybindings.find(
      ({ command }) => command === 'todo.numberedListEnter'
    );
    expect(binding.key).to.equal('Enter');
    [
      'editorLangId == todo',
      '!editorReadonly',
      '!isComposing',
      'config.todo.autoRenumber',
      '!suggestWidgetVisible',
      '!inSnippetMode',
      '!editorHasSelection',
      '!editorHasMultipleSelections',
    ].forEach((condition) => expect(binding.when).to.include(condition));
  });
});
