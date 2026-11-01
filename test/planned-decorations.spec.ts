import { expect } from 'chai';
import * as _ from 'lodash';
import * as path from 'path';
import Regex from '../src/utils/regex';

const withDecorations = (run) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const sourceRoot = path.resolve(__dirname, '../src') + path.sep;
  const previous = {};
  const clearSourceCache = () => {
    Object.keys(require.cache)
      .filter((key) => key.startsWith(sourceRoot))
      .forEach((key) => {
        delete require.cache[key];
      });
  };
  Object.keys(require.cache)
    .filter((key) => key.startsWith(sourceRoot))
    .forEach((key) => {
      previous[key] = require.cache[key];
    });
  clearSourceCache();

  const settings = {};
  const properties = require('../package.json').contributes.configuration.properties;
  Object.keys(properties).forEach((key) =>
    _.set(settings, key.slice(5), _.cloneDeep(properties[key].default))
  );
  _.set(settings, 'planned.enabled', true);
  const config = { get: () => settings, getKey: (key) => _.get(settings, key) };
  const types = [];

  class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  }
  class Range {
    start: Position;
    end: Position;
    constructor(start, startCharacter, endLine?, endCharacter?) {
      this.start = typeof start === 'number' ? new Position(start, startCharacter) : start;
      this.end = typeof start === 'number' ? new Position(endLine, endCharacter) : startCharacter;
    }
    isEqual(other: Range) {
      return (
        this.start.line === other.start.line &&
        this.start.character === other.start.character &&
        this.end.line === other.end.line &&
        this.end.character === other.end.character
      );
    }
  }

  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode')
      return {
        Position,
        Range,
        DecorationRangeBehavior: { ClosedClosed: 0 },
        window: {
          createTextEditorDecorationType: (options) => {
            const type = {
              options,
              disposed: false,
              dispose() {
                this.disposed = true;
              },
            };
            types.push(type);
            return type;
          },
        },
      };
    if (request === './config' || request === '../config' || request === '../../config')
      return { default: config };
    if (request === '../utils' || request === '../../utils')
      return {
        default: { regex: Regex, editor: { isSupported: () => true } },
      };
    return originalLoad(request, parent, isMain);
  };

  try {
    const Document = require('../src/todo/document').default;
    const Decorator = require('../src/todo/decorators/document').default;
    const { getPlannedDecorations } = require('../src/todo/decorators/todo_planned');
    const Consts = require('../src/consts').default;
    const makeEditor = (text: string) => {
      const lines = text.split('\n');
      const calls = [];
      const document = {
        getText: () => text,
        positionAt: (offset: number) => {
          const before = text.slice(0, offset).split('\n');
          return new Position(before.length - 1, before[before.length - 1].length);
        },
        lineAt: (line: number) => ({ text: lines[line], lineNumber: line }),
      };
      return { document, calls, setDecorations: (type, ranges) => calls.push({ type, ranges }) };
    };
    run({
      settings,
      types,
      Consts,
      makeEditor,
      Decorator,
      decorate: (text: string, now = new Date(2026, 10, 2, 11)) => {
        const editor = makeEditor(text);
        return getPlannedDecorations(new Document(editor).getTodosBox(), now)[0];
      },
    });
  } finally {
    NodeModule._load = originalLoad;
    clearSourceCache();
    Object.assign(require.cache, previous);
  }
};

describe('Planned tag decorations', () => {
  it('decorates unfinished tasks with correct indented offsets, including Markdown and custom symbols', () => {
    withDecorations(({ decorate, settings, Consts }) => {
      _.set(settings, 'symbols.box', '-');
      Consts.update();
      const lines = [
        'Project: @planned(10am-1pm)',
        '  ☐ Work @planned(10am-1pm)',
        '  - [ ] Markdown @planned(10am-1pm)',
        '  - Custom @planned(10am-1pm)',
        '  ☐ Started @started @planned(10am-1pm)',
        '  ☐ Explain `@done` @planned(10am-1pm)',
        '  ✔ Finished @planned(10am-1pm)',
        '  ✘ Cancelled @planned(10am-1pm)',
        '  - [x] Finished Markdown @planned(10am-1pm)',
        '  ☐ Finished by tag @done @planned(10am-1pm)',
        '  ☐ Cancelled by tag @cancelled @planned(10am-1pm)',
        '  Note @planned(10am-1pm)',
        '  ☐ Example `@planned(10am-1pm)`',
      ];
      const decoration = decorate(lines.join('\n'));
      expect(decoration.ranges.map((range) => range.start.line)).to.deep.equal([1, 2, 3, 4, 5]);
      decoration.ranges.forEach((range) => {
        expect(lines[range.start.line].slice(range.start.character, range.end.character)).to.equal(
          '@planned(10am-1pm)'
        );
      });
    });
  });

  it('clears active tags after end time or disablement and applies changed theme colors', () => {
    withDecorations(({ decorate, settings, Consts }) => {
      const text = '☐ Work @planned(10am-1pm)';
      const original = decorate(text);
      expect(original.ranges).to.have.length(1);
      expect(decorate(text, new Date(2026, 10, 2, 13)).ranges).to.deep.equal([]);
      _.set(settings, 'colors.planned', 'base');
      _.set(settings, 'colors.dark.planned', 'dark');
      _.set(settings, 'colors.light.planned', 'light');
      Consts.update();
      const changed = decorate(text);
      expect(original.type.disposed).to.equal(true);
      expect(changed.type.options).to.include({ color: 'base', fontWeight: 'bold' });
      expect(changed.type.options.dark.color).to.equal('dark');
      expect(changed.type.options.light.color).to.equal('light');
      _.set(settings, 'planned.enabled', false);
      expect(decorate(text).ranges).to.deep.equal([]);
    });
  });

  it('respects disabled editor colors and clears the same decoration type on refresh', () => {
    withDecorations(({ decorate, settings, makeEditor, Decorator }) => {
      const active = decorate('☐ Work @planned(10am-1pm)');
      _.set(settings, 'colors.enabled', false);
      const editor = makeEditor('☐ Work @planned(10am-1pm)');
      Decorator.updatePlanned(editor);
      expect(editor.calls.find((call) => call.type === active.type).ranges).to.deep.equal([]);
      expect(editor.calls.every((call) => call.ranges.length === 0)).to.equal(true);
    });
  });

  it('removes competing tag colors while active and restores them when a window ends', () => {
    withDecorations(({ decorate, settings, Consts, makeEditor, Decorator }) => {
      const text = '☐ Work @planned(10am-1pm)';
      for (const special of [false, true]) {
        if (special) {
          _.set(settings, 'tags.names', ['planned']);
          Consts.update();
        }
        const active = decorate(text);
        const editor = makeEditor(text);
        Decorator.updatePlanned(editor, new Date(2026, 10, 2, 11));
        expect(editor.calls.find((call) => call.type === active.type).ranges).to.have.length(1);
        expect(
          editor.calls
            .filter((call) => call.type !== active.type)
            .every((call) => call.ranges.length === 0)
        ).to.equal(true);
        editor.calls.length = 0;
        Decorator.updatePlanned(editor, new Date(2026, 10, 2, 13));
        expect(editor.calls.find((call) => call.type === active.type).ranges).to.deep.equal([]);
        expect(
          editor.calls.some((call) => call.type !== active.type && call.ranges.length === 1)
        ).to.equal(true);
      }
    });
  });

  it('keeps urgency-colored due tags out of the generic foreground during planned refreshes', () => {
    withDecorations(({ makeEditor, Decorator, Consts }) => {
      const text = '☐ Work @due(2099-01-01) @planned(10am-1pm)';
      const editor = makeEditor(text);
      Decorator.updatePlanned(editor, new Date(2026, 10, 2, 11));
      const generic = editor.calls.find((call) => call.type.options.color === Consts.colors.tag);
      const due = editor.calls.find((call) => call.type.options.color === Consts.colors.due.later);
      expect(generic.ranges).to.deep.equal([]);
      expect(due.ranges).to.have.length(1);
      expect(text.slice(due.ranges[0].start.character, due.ranges[0].end.character)).to.equal(
        '@due(2099-01-01)'
      );
    });
  });
});
