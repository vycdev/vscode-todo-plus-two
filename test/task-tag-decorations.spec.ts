import { expect } from 'chai';

const withTaskStyles = (run) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    modulePath = require.resolve('../src/todo/decorators/task-tags'),
    previous = require.cache[modulePath],
    created: any[] = [],
    config: any = { colors: { dark: {}, light: {} }, tags: { styles: {} } };

  class Range {
    start;
    end;
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }

  NodeModule._load = (request, parent, isMain) => {
    if (parent && parent.filename === modulePath) {
      if (request === 'vscode')
        return {
          Range,
          DecorationRangeBehavior: { ClosedOpen: 'closed-open' },
          window: {
            createTextEditorDecorationType: (options) => {
              const type = {
                options,
                disposed: false,
                dispose() {
                  this.disposed = true;
                },
              };
              created.push(type);
              return type;
            },
          },
        };
      if (request === '../../config')
        return {
          default: {
            get: () => config,
            getKey: () => config.colors.enabled,
          },
        };
    }
    return originalLoad(request, parent, isMain);
  };

  const todo = (text) => ({ text, range: new Range(2, 4, 2, 4 + text.length) });
  try {
    delete require.cache[modulePath];
    const styles = require(modulePath);
    run({ ...styles, todo, config, created });
    styles.disposeTaskTagStyles();
    expect(created.every((type) => type.disposed)).to.equal(true);
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[modulePath];
    if (previous) require.cache[modulePath] = previous;
  }
};

describe('Task tag decorations', () => {
  it('styles actual tags and preserves their labels and inline-code ranges', () => {
    withTaskStyles(({ getTaskTagDecorations, todo, config }) => {
      config.tags.styles.blocked = { color: 'red', bold: true, backgroundColor: 'yellow' };
      const text = '☐ Work `code` @blocked';
      const [decoration] = getTaskTagDecorations([todo(text)]);
      expect(decoration.type.options).to.include({
        color: 'red',
        fontWeight: 'bold',
        backgroundColor: 'yellow',
      });
      expect(
        decoration.ranges.map((range) => [
          range.start.line,
          range.start.character,
          range.end.character,
        ])
      ).to.deep.equal([
        [2, 4, 11],
        [2, 17, 18],
      ]);
    });
  });

  it('clears previous decorations after the matching tag is removed', () => {
    withTaskStyles(({ getTaskTagDecorations, todo }) => {
      const [initial] = getTaskTagDecorations([todo('✔ Work @done')]);
      const cleared = getTaskTagDecorations([todo('✔ Work')]);
      expect(initial.ranges).not.to.be.empty;
      expect(cleared).to.deep.equal([]);
      expect(initial.type.disposed).to.equal(true);
    });
  });

  it('uses legacy appearance defaults and replaces types after live settings changes', () => {
    withTaskStyles(({ getTaskTagDecorations, todo, config }) => {
      config.colors.started = 'blue';
      const [initial] = getTaskTagDecorations([todo('☐ Work @started')]);
      expect(initial.type.options.color).to.equal('blue');
      expect(getTaskTagDecorations([todo('☐ Work @started')])[0].type).to.equal(initial.type);
      config.colors.started = 'purple';
      const [updated] = getTaskTagDecorations([todo('☐ Work @started')]);
      expect(initial.type.disposed).to.equal(true);
      expect(updated.type.options.color).to.equal('purple');
      config.tags.styles.started = false;
      expect(getTaskTagDecorations([todo('☐ Work @started')])).to.deep.equal([]);
      expect(updated.type.disposed).to.equal(true);
    });
  });

  it('retains font styles when custom colors are disabled', () => {
    withTaskStyles(({ getTaskTagDecorations, todo, config }) => {
      config.colors.enabled = false;
      const [decoration] = getTaskTagDecorations([todo('✔ Work @done')]);
      expect(decoration.type.options.textDecoration).to.equal('line-through');
      expect(decoration.type.options).not.to.have.property('color');
      expect(decoration.type.options.dark).not.to.have.property('color');
      expect(decoration.type.options.light).not.to.have.property('color');
    });
  });

  it('supports explicit false font properties and legacy done preferences', () => {
    withTaskStyles(({ getTaskTagDecorations, todo, config }) => {
      config.decorations = { done: { strikethrough: false } };
      config.tags.styles.done = { bold: false, italic: false };
      const [decoration] = getTaskTagDecorations([todo('✔ Work @done')]);
      expect(decoration.type.options).to.include({
        textDecoration: 'none',
        fontWeight: 'normal',
        fontStyle: 'normal',
      });
    });
  });

  it('lets empty theme overrides clear base colors without affecting the other theme', () => {
    for (const theme of ['dark', 'light']) {
      withTaskStyles(({ getTaskTagDecorations, todo, config }) => {
        config.tags.styles.custom = {
          color: '#ff0000',
          backgroundColor: '#ffff00',
          [theme]: { color: '', backgroundColor: '' },
        };
        const [decoration] = getTaskTagDecorations([todo('☐ Work @custom')]);
        expect(decoration.type.options, theme).not.to.have.property('color');
        expect(decoration.type.options, theme).not.to.have.property('backgroundColor');
        expect(decoration.type.options[theme], theme).not.to.have.property('color');
        expect(decoration.type.options[theme], theme).not.to.have.property('backgroundColor');
        const otherTheme = theme === 'dark' ? 'light' : 'dark';
        expect(decoration.type.options[otherTheme], theme).to.include({
          color: '#ff0000',
          backgroundColor: '#ffff00',
        });
      });
    }
  });

  it('clears each theme property independently while retaining its other appearance', () => {
    withTaskStyles(({ getTaskTagDecorations, todo, config }) => {
      config.tags.styles.custom = {
        color: '#ff0000',
        backgroundColor: '#ffff00',
        bold: true,
        dark: { backgroundColor: '' },
        light: { color: '' },
      };
      const [decoration] = getTaskTagDecorations([todo('☐ Work @custom')]);
      expect(decoration.type.options.dark).to.include({ color: '#ff0000', fontWeight: 'bold' });
      expect(decoration.type.options.dark).not.to.have.property('backgroundColor');
      expect(decoration.type.options.light).to.include({
        backgroundColor: '#ffff00',
        fontWeight: 'bold',
      });
      expect(decoration.type.options.light).not.to.have.property('color');
    });
  });

  it('does not infer styling from task symbols or toggle counts', () => {
    withTaskStyles(({ getTaskTagDecorations, todo }) => {
      expect(getTaskTagDecorations([todo('✔ Done'), todo('✘ Cancelled')])).to.deep.equal([]);
      const [decoration] = getTaskTagDecorations([
        todo('☐ Work @started(2026-01-01) @toggle(2026-01-02)'),
      ]);
      expect(decoration.type.options.color).to.equal('#4fc1ff');
    });
  });

  it('releases obsolete styles instead of retaining every previously used combination', () => {
    withTaskStyles(({ getTaskTagDecorations, todo, config, created }) => {
      for (let index = 0; index < 40; index++)
        config.tags.styles[`label${index}`] = { color: `color-${index}` };
      for (let index = 0; index < 40; index++) {
        const decorations = getTaskTagDecorations([todo(`☐ Work @label${index}`)]);
        expect(decorations).to.have.length(1);
        expect(created.filter((type) => !type.disposed)).to.have.length(1);
      }
      expect(getTaskTagDecorations([])).to.deep.equal([]);
      expect(created.every((type) => type.disposed)).to.equal(true);
    });
  });

  it('keeps document caches independent and releases only the closed document', () => {
    withTaskStyles(({ getTaskTagDecorations, disposeTaskTagDocument, todo }) => {
      const firstDocument = {},
        secondDocument = {};
      const [first] = getTaskTagDecorations([todo('☐ Work @started')], firstDocument);
      const [second] = getTaskTagDecorations([todo('☐ Work @paused')], secondDocument);
      expect(first.type.disposed).to.equal(false);
      getTaskTagDecorations([], secondDocument);
      expect(second.type.disposed).to.equal(true);
      expect(first.type.disposed).to.equal(false);
      const [reopened] = getTaskTagDecorations([todo('☐ Work @paused')], secondDocument);
      disposeTaskTagDocument(firstDocument);
      expect(first.type.disposed).to.equal(true);
      expect(reopened.type.disposed).to.equal(false);
    });
  });
});
