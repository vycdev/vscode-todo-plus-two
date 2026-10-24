import { expect } from 'chai';

const withColorDecorator = (name, run) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    subjectPath = require.resolve(`../src/todo/decorators/${name}`),
    cachePath = require.resolve('../src/todo/decorators/cached-type'),
    previous = require.cache[subjectPath],
    previousCache = require.cache[cachePath];
  const colors = { comment: 'red', cancelled: 'red', code: 'red', dark: {}, light: {} };
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode')
      return {
        DecorationRangeBehavior: {},
        window: {
          createTextEditorDecorationType: (options) => ({
            options,
            disposed: false,
            dispose() {
              this.disposed = true;
            },
          }),
        },
      };
    if (request === '../../consts') return { default: { colors } };
    if (request === './line') return { default: class Line {} };
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[subjectPath];
    delete require.cache[cachePath];
    run(require(subjectPath).default, colors);
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    delete require.cache[cachePath];
    if (previous) require.cache[subjectPath] = previous;
    if (previousCache) require.cache[cachePath] = previousCache;
  }
};

describe('Live decoration colors', () => {
  for (const [name, color] of [
    ['comment', 'comment'],
    ['todo_cancelled', 'cancelled'],
    ['formatted', 'code'],
  ]) {
    it(`updates ${color} colors and disposes obsolete decoration types`, () => {
      withColorDecorator(name, (Decorator, colors) => {
        const original = new Decorator().TYPES[0];
        expect(new Decorator().TYPES[0]).to.equal(original);
        colors[color] = 'blue';
        const updated = new Decorator().TYPES[0];
        expect(updated).not.to.equal(original);
        expect(original.disposed).to.equal(true);
        expect(updated.options.color).to.equal('blue');
      });
    });
  }
});
