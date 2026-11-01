import { expect } from 'chai';
import { withDecorationEditor } from './helpers/decoration-editor';

const tokenValues = (tokens) =>
  tokens && {
    values: [
      'comments',
      'projects',
      'tags',
      'pending',
      'done',
      'cancelled',
      'estSeconds',
      'estTotalSeconds',
      'lastedSeconds',
      'wastedSeconds',
    ].map((key) => tokens[key]),
    tags: tokens.tagNames,
    tagged: tokens.taggedTodos?.map(tokenValues),
  };

const snapshot = ({ decorations, utils }) => ({
  decorations: [...decorations.entries()]
    .filter(([type]) => !type.disposed)
    .map(([type, ranges]) => ({ style: type.options, ranges: JSON.parse(JSON.stringify(ranges)) })),
  global: tokenValues(utils.statistics.tokens.global),
  projects: Object.entries(utils.statistics.tokens.projects).map(([line, tokens]) => [
    line,
    tokenValues(tokens),
  ]),
});

const expectFullParse = (state) => {
  const incremental = snapshot(state);
  const decorations = new Map(),
    previous = state.window.activeTextEditor,
    visible = state.window.visibleTextEditors;
  const reference = {
    ...state.editor,
    document: { ...state.editor.document },
    setDecorations: (type, ranges) => decorations.set(type, ranges),
  };
  state.window.activeTextEditor = reference;
  state.window.visibleTextEditors = [...visible, reference];
  try {
    state.decorator.update(reference);
    expect(snapshot({ decorations, utils: state.utils })).to.deep.equal(incremental);
  } finally {
    state.window.activeTextEditor = previous;
    state.window.visibleTextEditors = visible;
  }
};

describe('Incremental Todo decorations and statistics', () => {
  it('updates both split editors and preserves each editor cache', () => {
    withDecorationEditor('Todo:\n  ☐ First @high', (state) => {
      const secondDecorations = new Map();
      const second = {
        ...state.editor,
        setDecorations: (type, ranges) => secondDecorations.set(type, ranges),
      };
      state.window.visibleTextEditors.push(second);
      state.decorator.update(state.editor);
      state.decorator.update(second);
      const reads = state.calls.fullText;
      state.edit(1, 0, 100, '  ✔ First @low');
      expect(state.calls.fullText).to.equal(reads);
      expect(
        snapshot({ decorations: secondDecorations, utils: state.utils }).decorations
      ).to.deep.equal(snapshot(state).decorations);
      expectFullParse(state);
    });
  });
  for (const eol of ['\n', '\r\n']) {
    for (const [before, after] of [
      ['  ☐ Buy milk', '  ☐ Buy fresh milk'],
      ['  ☐ Buy milk @high', '  ☐ Buy oat milk @high'],
      ['  ☐ Buy milk @est(10m)', '  ☐ Buy milk @est(20m)'],
      ['  ☐ Buy milk @est(1.5s)', '  ☐ Buy milk @est(1.7s)'],
      ['  ☐ Buy milk @due(today)', '  ☐ Buy milk @due(later)'],
      ['  ☐ Buy milk @started(26-11-01 10:00)', '  ☐ Buy oats @started(26-11-01 10:00)'],
      ['  ☐ Buy milk @id(milk)', '  ☐ Buy milk @id(oats)'],
      ['  ☐ Buy milk @depends(milk)', '  ☐ Buy milk @depends(oats)'],
      ['  ☐ Buy milk', '  ✔ Buy milk'],
      ['  ✔ Buy milk @lasted(2m)', '  ✘ Buy milk @wasted(2m)'],
      ['  ☐ Buy milk', '  ☐ Buy *milk* and `oats`'],
      ['  ☐ Buy *milk*', '  ☐ Buy milk'],
      ['  ☐ Buy milk', '    ☐ Buy milk'],
      ['  ☐ Buy milk', '  Note about milk'],
      ['  ☐ Buy milk', '  New project: @high'],
    ]) {
      it(`matches a full parse for ${JSON.stringify(after)} (${JSON.stringify(eol)})`, () => {
        withDecorationEditor(
          ['Todo:', before, 'Other:', '  ☐ Bake bread @low'].join(eol),
          (state) => {
            const { decorator, editor, edit, calls } = state;
            decorator.update(editor);
            const reads = calls.fullText,
              parses = calls.parses;
            edit(1, 0, before.length, after);
            expect(calls.fullText).to.equal(reads);
            expect(calls.parses - parses).to.equal(1);
            expectFullParse(state);
          }
        );
      });
    }
  }

  it('does no decoration submission or statistics work for plain title edits', () => {
    withDecorationEditor('Todo:\n  ☐ Buy milk\nOther:\n  ☐ Bake bread', (state) => {
      const { decorator, editor, edit, calls } = state;
      decorator.update(editor);
      const before = { ...calls };
      edit(1, 8, 8, 'fresh ');
      edit(1, 8, 14, '');
      expect(calls.fullText).to.equal(before.fullText);
      expect(calls.decorations).to.equal(before.decorations);
      expect(calls.contributions).to.equal(before.contributions);
      expect(calls.projectComputations).to.equal(before.projectComputations);
      expect(calls.timer).to.equal(before.timer);
      expectFullParse(state);
    });
  });

  it('updates global totals using only changed-line contributions for integer durations', () => {
    withDecorationEditor('Todo:\n  ☐ First @est(10m)\nOther:\n  ☐ Second @est(5m)', (state) => {
      state.config.statistics.statusbar.text = '[est] [pending]';
      state.utils.statistics.tokens.updateDisabledAll();
      state.decorator.update(state.editor);
      const before = state.calls.contributions;
      state.edit(1, 0, 100, '  ☐ First @est(20m)');
      expect(state.calls.contributions - before).to.equal(2);
      expect(state.utils.statistics.tokens.global.estSeconds).to.equal(1500);
      expectFullParse(state);
    });
  });

  it('recomputes an edited project and its ancestors while reusing sibling tokens', () => {
    withDecorationEditor(
      'Root:\n  Child:\n    ☐ First @est(10m)\n  Sibling:\n    ☐ Second @est(5m)\nOther:\n  ☐ Third',
      (state) => {
        const { decorator, editor, edit, calls, utils } = state;
        decorator.update(editor);
        const sibling = utils.statistics.tokens.projects[3],
          other = utils.statistics.tokens.projects[5],
          computations = calls.projectComputations;
        edit(2, 0, 100, '    ✔ First @est(10m)');
        expect(calls.projectComputations - computations).to.equal(2);
        expect(utils.statistics.tokens.projects[3]).to.equal(sibling);
        expect(utils.statistics.tokens.projects[5]).to.equal(other);
        expect(utils.statistics.tokens.projects[0].done).to.equal(1);
        expectFullParse(state);
      }
    );
  });

  for (const eol of ['\n', '\r\n']) {
    it(`rebases unaffected lines after insertions and deletions (${JSON.stringify(eol)})`, () => {
      withDecorationEditor(
        ['Todo:', '  ☐ First @high', 'Other:', '  ✔ Second @low'].join(eol),
        (state) => {
          const { decorator, editor, edit, calls, utils, setText, changes, Range } = state;
          decorator.update(editor);
          const sibling = utils.statistics.tokens.projects[2],
            reads = calls.fullText;
          edit(1, 9, 9, `${eol}  ☐ New `);
          expect(calls.fullText).to.equal(reads);
          expect(utils.statistics.tokens.projects[3]).to.equal(sibling);
          expectFullParse(state);
          const current = state.getText().split(eol);
          setText([current[0], '  ☐ First @high', ...current.slice(3)].join(eol));
          changes.onChanges({
            document: editor.document,
            contentChanges: [
              { range: new Range(1, 0, 2, current[2].length), text: '  ☐ First @high' },
            ],
          });
          expect(calls.fullText).to.equal(reads + 1);
          expectFullParse(state);
        }
      );
    });
  }

  it('handles mixed multi-cursor edits with line shifts using previous-document coordinates', () => {
    withDecorationEditor(
      'One:\n  ☐ First @high\nTwo:\n  ☐ Second @low\nThree:\n  ☐ Third',
      (state) => {
        const { decorator, editor, setText, changes, Range, calls } = state;
        decorator.update(editor);
        const reads = calls.fullText;
        setText('One:\n  ☐ First @high\n  ☐ Added\nTwo:\n  ✔ Second @low\nThree:\n  ☐ Third');
        changes.onChanges({
          document: editor.document,
          contentChanges: [
            { range: new Range(3, 2, 3, 3), text: '✔' },
            { range: new Range(1, 15, 1, 15), text: '\n  ☐ Added' },
          ],
        });
        expect(calls.fullText).to.equal(reads);
        expectFullParse(state);
      }
    );
  });

  for (const eol of ['\n', '\r\n']) {
    it(`preserves the configured line ending when inserting the first newline (${JSON.stringify(eol)})`, () => {
      withDecorationEditor('  ✔ Done', (state) => {
        Object.defineProperty(state.editor.document, 'eol', {
          enumerable: true,
          value: eol === '\r\n' ? 2 : 1,
        });
        state.decorator.update(state.editor);
        const reads = state.calls.fullText,
          end = state.editor.document.lineAt(0).text.length;
        state.edit(0, end, end, `${eol}  ☐ New`);
        expect(state.calls.fullText).to.equal(reads);
        expectFullParse(state);
      });
    });
  }

  it('rebuilds safely when the document line endings change', () => {
    withDecorationEditor('Todo:\n  ✔ First @high', (state) => {
      state.decorator.update(state.editor);
      for (const eol of ['\r\n', '\n']) {
        const previous = state.getText().split(/\r?\n/),
          text = previous.join(eol),
          reads = state.calls.fullText;
        state.setText(text);
        state.changes.onChanges({
          document: state.editor.document,
          contentChanges: [
            {
              range: new state.Range(
                0,
                0,
                previous.length - 1,
                previous[previous.length - 1].length
              ),
              text,
            },
          ],
        });
        expect(state.calls.fullText).to.equal(reads + 1);
        expectFullParse(state);
      }
    });
  });

  it('updates archive boundaries and tag-scoped statistics', () => {
    withDecorationEditor(
      'Todo:\n  ☐ First @high @est(10m)\nArchive:\n  ✔ Old @low @lasted(2m)',
      (state) => {
        const { decorator, editor, edit, config } = state;
        config.statistics.statusbar.text = '[tag:high:pending] [tag:low:elapsed]';
        config.statistics.project.text = '[tag:high:all] [tag:low:elapsed]';
        require('../src/consts').default.update();
        state.utils.statistics.tokens.updateDisabledAll();
        decorator.update(editor);
        edit(2, 0, 8, 'Old tasks:');
        expectFullParse(state);
        edit(2, 0, 10, 'Archive:');
        expectFullParse(state);
      }
    );
  });

  it('finds the next Archive header when the first one is renamed', () => {
    withDecorationEditor('Todo:\n  ☐ First\nArchive:\n  ✔ Second\nArchive:\n  ✔ Third', (state) => {
      state.decorator.update(state.editor);
      state.edit(2, 0, 8, 'Old tasks:');
      expectFullParse(state);
      state.edit(4, 0, 8, 'More old tasks:');
      expectFullParse(state);
    });
  });

  it('invalidates ancestors of a nested Archive when its EOF scope changes', () => {
    withDecorationEditor('Root:\n  Archive:\n    ✔ Archived\nOther:\n  ☐ Task', (state) => {
      state.decorator.update(state.editor);
      state.edit(4, 2, 3, '✔');
      expect(state.utils.statistics.tokens.projects[0].pending).to.equal(0);
      expect(state.utils.statistics.tokens.projects[0].done).to.equal(2);
      expectFullParse(state);
      state.edit(1, 0, 10, '  Old tasks:');
      expectFullParse(state);
    });
  });

  it('updates project annotations whose visibility depends on global statistics', () => {
    withDecorationEditor('One:\n  ☐ First\nTwo:\n  ☐ Second', (state) => {
      state.config.statistics.project.enabled = 'global.done > 0';
      state.decorator.update(state.editor);
      state.edit(1, 2, 3, '✔');
      expectFullParse(state);
      state.edit(1, 2, 3, '☐');
      expectFullParse(state);
    });
  });

  it('falls back for unfinished multiline arguments and resumes caching after repair', () => {
    withDecorationEditor('Todo:\n  ☐ First @due(today)', (state) => {
      state.decorator.update(state.editor);
      state.edit(1, 20, 21, '');
      expectFullParse(state);
      const reads = state.calls.fullText;
      state.edit(1, 0, 100, '  ☐ First @due(today)');
      expect(state.calls.fullText).to.be.greaterThan(reads);
      const afterRepair = state.calls.fullText;
      state.edit(1, 8, 8, 'new ');
      expect(state.calls.fullText).to.equal(afterRepair);
      expectFullParse(state);
    });
  });

  for (const marker of ['☐', '✔', '✘', '- [ ]', '- [x]']) {
    it(`falls back when deleting the separator after ${marker}`, () => {
      withDecorationEditor(`Todo:\n  ${marker} \n  Note`, (state) => {
        state.decorator.update(state.editor);
        const reads = state.calls.fullText;
        state.edit(1, 0, state.editor.document.lineAt(1).text.length, `  ${marker}`);
        expect(state.calls.fullText).to.equal(reads + 1);
        expectFullParse(state);
      });
    });
  }

  for (const gap of ['\n', '\n\n  \n']) {
    it(`keeps split Markdown checkbox markers on the full parser (${JSON.stringify(gap)})`, () => {
      withDecorationEditor(`Todo:\n  -${gap}  [ ] Task`, (state) => {
        state.decorator.update(state.editor);
        const reads = state.calls.fullText,
          line = state.editor.document.lineCount - 1;
        state.edit(line, 0, state.editor.document.lineAt(line).text.length, '  [x] Task');
        expect(state.calls.fullText).to.equal(reads + 1);
        expect(state.utils.statistics.tokens.global.pending).to.equal(0);
        expect(state.utils.statistics.tokens.global.done).to.equal(1);
        expectFullParse(state);
      });
    });
  }

  it('resumes incremental editing once a bare task marker has a title', () => {
    withDecorationEditor('Todo:\n  ☐\n  Note', (state) => {
      state.decorator.update(state.editor);
      state.edit(1, 0, 3, '  ☐ Title');
      const reads = state.calls.fullText;
      state.edit(1, 4, 4, 'New ');
      expect(state.calls.fullText).to.equal(reads);
      expectFullParse(state);
    });
  });

  it('handles overlapping configured symbols at a line boundary', () => {
    withDecorationEditor('Todo:\n  ☐ \n  Note', (state) => {
      state.config.symbols.box = '☐ ';
      require('../src/consts').default.update();
      state.decorator.update(state.editor);
      const reads = state.calls.fullText;
      state.edit(2, 0, 6, '  Note @started(26-11-01 10:00)');
      expect(state.calls.fullText).to.equal(reads + 1);
      expectFullParse(state);
    });
  });

  it('checks long tag-like lines without quadratic backtracking', () => {
    withDecorationEditor('Todo:\n  ☐ Task', () => {
      const { hasMultilineSyntax } = require('../src/todo/decorators/incremental-document');
      expect(hasMultilineSyntax('@'.repeat(100000))).to.equal(false);
      expect(hasMultilineSyntax('@('.repeat(50000) + ')')).to.equal(false);
      expect(hasMultilineSyntax('@'.repeat(100000) + '(')).to.equal(true);
    });
  });

  it('preserves multiline tag boundary semantics across generated inputs', () => {
    withDecorationEditor('Todo:\n  ☐ Task', () => {
      const { hasMultilineSyntax } = require('../src/todo/decorators/incremental-document'),
        canonical = /@[^()\r\n]*\([^\r\n)]*(?:\r?\n|$)/;
      const alphabet = '@()abc \n\t';
      let seed = 94;
      for (let sample = 0; sample < 1000; sample++) {
        let input = '';
        for (let index = 0; index < 50; index++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          input += alphabet[seed % alphabet.length];
        }
        expect(hasMultilineSyntax(input), JSON.stringify(input)).to.equal(canonical.test(input));
      }
    });
  });

  for (const invalidate of ['configuration', 'indentation', 'editor', 'day', 'missed event']) {
    it(`rebuilds after ${invalidate} changes`, () => {
      withDecorationEditor('Todo:\n  ☐ First @high', (state) => {
        const { decorator, editor, window, edit, calls } = state;
        decorator.update(editor);
        const reads = calls.fullText,
          date = Date.prototype.toDateString;
        try {
          if (invalidate === 'configuration') require('../src/consts').default.update();
          if (invalidate === 'indentation') editor.options.tabSize = 4;
          if (invalidate === 'editor') {
            window.visibleTextEditors = [{ ...editor }];
            window.activeTextEditor = window.visibleTextEditors[0];
          }
          if (invalidate === 'day') Date.prototype.toDateString = () => 'next day';
          if (invalidate === 'missed event') editor.document.version++;
          edit(1, 8, 8, 'new ');
          expect(calls.fullText).to.be.greaterThan(reads);
        } finally {
          Date.prototype.toDateString = date;
        }
      });
    });
  }

  it('recalculates calendar estimates without reparsing unrelated lines', () => {
    const RealDate = Date;
    let now = new RealDate(2026, 10, 1, 12).getTime();
    (global as any).Date = new Proxy(RealDate, {
      construct: (target, args) => Reflect.construct(target, args.length ? args : [now]),
      get: (target, key) => (key === 'now' ? () => now : Reflect.get(target, key)),
    });
    try {
      withDecorationEditor(
        'Todo:\n  ☐ First @est(2026-11-02)\nOther:\n  ☐ Second @est(1h)',
        (state) => {
          state.decorator.update(state.editor);
          const sibling = state.utils.statistics.tokens.projects[2],
            reads = state.calls.fullText;
          now += 60000;
          state.edit(3, 8, 8, 'new ');
          expect(state.calls.fullText).to.equal(reads);
          expect(state.utils.statistics.tokens.projects[2]).to.equal(sibling);
          expectFullParse(state);
        }
      );
    } finally {
      (global as any).Date = RealDate;
    }
  });

  for (const [replacement, seconds] of [
    ['  ☐ Task @est(1h)', 3600],
    ['  ☐ Task', 0],
  ] as const) {
    it(`drops stale calendar contributions when switching to ${JSON.stringify(replacement)}`, () => {
      const RealDate = Date;
      let now = new RealDate(2026, 10, 1, 12).getTime();
      (global as any).Date = new Proxy(RealDate, {
        construct: (target, args) => Reflect.construct(target, args.length ? args : [now]),
        get: (target, key) => (key === 'now' ? () => now : Reflect.get(target, key)),
      });
      try {
        withDecorationEditor('Todo:\n  ☐ Task @est(2026-11-02)', (state) => {
          state.config.statistics.statusbar.text = '[est]';
          state.utils.statistics.tokens.updateDisabledAll();
          state.decorator.update(state.editor);
          expect(state.utils.statistics.tokens.global.estSeconds).to.equal(43200);
          now += 60000;
          state.edit(1, 0, state.editor.document.lineAt(1).text.length, replacement);
          expect(state.utils.statistics.tokens.global.estSeconds).to.equal(seconds);
          expectFullParse(state);
        });
      } finally {
        (global as any).Date = RealDate;
      }
    });
  }

  it('refreshes relative due colors when their meaning changes within the same day', () => {
    const RealDate = Date;
    let now = new RealDate(2026, 10, 1, 0).getTime();
    (global as any).Date = new Proxy(RealDate, {
      construct: (target, args) => Reflect.construct(target, args.length ? args : [now]),
      get: (target, key) => (key === 'now' ? () => now : Reflect.get(target, key)),
    });
    try {
      withDecorationEditor('Todo:\n  ☐ First @due(in 23 hours)\n  ☐ Other', (state) => {
        state.decorator.update(state.editor);
        now += 2 * 3600000;
        state.edit(2, 4, 4, 'new ');
        expectFullParse(state);
      });
    } finally {
      (global as any).Date = RealDate;
    }
  });

  for (const mode of [
    'custom symbols',
    'line colors',
    'theme colors',
    'disabled formatting',
    'disabled statistics',
  ]) {
    it(`matches full refreshes with ${mode}`, () => {
      withDecorationEditor(
        'Todo:\n  ☐ First @high @low\n  - [ ] Second\nArchive:\n  ✔ Old',
        (state) => {
          const { config, utils, decorator, editor, edit } = state;
          if (mode === 'custom symbols') {
            config.symbols.done = '☐';
            config.symbols.cancelled = '☐';
          }
          if (mode === 'line colors') config.colors.tags.lineBackground = ['red', 'green', 'blue'];
          if (mode === 'theme colors') config.colors.enabled = false;
          if (mode === 'disabled formatting') config.formatting.enabled = false;
          if (mode === 'disabled statistics') {
            config.statistics.project.enabled = false;
            config.statistics.statusbar.enabled = false;
          }
          require('../src/consts').default.update();
          utils.statistics.tokens.updateDisabledAll();
          decorator.update(editor);
          edit(1, 0, 100, '  ☐ New *first* @low @high');
          expectFullParse(state);
          edit(2, 0, 100, '  - [x] Second @est(2h)');
          expectFullParse(state);
        }
      );
    });
  }

  it('matches full parses across a seeded sequence of text and structural edits', function () {
    this.timeout(15000);
    withDecorationEditor(
      'Root:\n  Child:\n    ☐ First @high\nOther:\n  ✔ Second @low\nArchive:\n  ✔ Old',
      (state) => {
        state.decorator.update(state.editor);
        let seed = 94;
        const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
        const choices = [
          '',
          'Root:',
          '  Child:',
          'Other:',
          'Archive:',
          '  ☐ Task @high @est(2h)',
          '  ✔ Task @low @lasted(10m)',
          '  ☐ Task @due(2027-01-01)',
          '  ☐ _formatted_ @depends(one)',
          '  ☐ `code` @id(one)',
          '\t☐ Task',
          '  Note @low',
        ];
        for (let iteration = 0; iteration < 100; iteration++) {
          const lines = state.getText().split('\n'),
            line = next() % lines.length,
            text = choices[next() % choices.length],
            operation = next() % 3;
          if (operation === 0 && lines.length > 2 && line < lines.length - 1) {
            lines.splice(line, 1);
            state.setText(lines.join('\n'));
            state.changes.onChanges({
              document: state.editor.document,
              contentChanges: [{ range: new state.Range(line, 0, line + 1, 0), text: '' }],
            });
          } else
            state.edit(
              line,
              0,
              lines[line].length,
              operation === 1 ? text + '\n' + lines[line] : text
            );
          expectFullParse(state);
        }
      }
    );
  });
});
