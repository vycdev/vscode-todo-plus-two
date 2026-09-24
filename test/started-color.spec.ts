import { expect } from 'chai';

const loadTodoStarted = () => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    decoratorPath = require.resolve('../src/todo/decorators/todo_started'),
    previousDecorator = require.cache[decoratorPath],
    createdDecorations: any[] = [];

  const colors = {
    started: 'started',
    dark: { started: 'dark-started' },
    light: { started: 'light-started' },
  };

  NodeModule._load = (request: string, parent, isMain: boolean) => {
    if (request === 'vscode') {
      return {
        DecorationRangeBehavior: { ClosedOpen: 'closed-open' },
        window: {
          createTextEditorDecorationType: (options) => {
            const decoration = {
              options,
              disposed: false,
              dispose() {
                this.disposed = true;
              },
            };
            createdDecorations.push(decoration);
            return decoration;
          },
        },
      };
    }
    if (request === '../../consts') {
      return {
        default: {
          colors,
          regexes: { tag: /@\w+/, formattedCode: /`[^`]+`/ },
        },
      };
    }
    if (request === '../items/todo_box') return { default: class TodoBoxItem {} };
    if (request === './line') return { default: class Line {} };

    return originalLoad(request, parent, isMain);
  };

  try {
    delete require.cache[decoratorPath];
    return {
      TodoStarted: require('../src/todo/decorators/todo_started').default,
      colors,
      createdDecorations,
    };
  } finally {
    NodeModule._load = originalLoad;
    if (previousDecorator) {
      require.cache[decoratorPath] = previousDecorator;
    } else {
      delete require.cache[decoratorPath];
    }
  }
};

describe('Started todo color decoration', () => {
  it('uses the configured base, dark, and light colors', () => {
    const { TodoStarted, createdDecorations } = loadTodoStarted();
    new TodoStarted();

    expect(createdDecorations[0].options).to.include({
      color: 'started',
      rangeBehavior: 'closed-open',
    });
    expect(createdDecorations[0].options.dark.color).to.equal('dark-started');
    expect(createdDecorations[0].options.light.color).to.equal('light-started');
  });

  it('replaces the decoration when the configured color changes', () => {
    const { TodoStarted, colors, createdDecorations } = loadTodoStarted();
    new TodoStarted();
    colors.started = 'updated';
    new TodoStarted();

    expect(createdDecorations).to.have.length(2);
    expect(createdDecorations[0].disposed).to.equal(true);
    expect(createdDecorations[1].options.color).to.equal('updated');
  });

  it('falls back to the base color when no theme override is configured', () => {
    const { TodoStarted, colors, createdDecorations } = loadTodoStarted();
    colors.dark.started = undefined;
    colors.light.started = undefined;
    new TodoStarted();

    expect(createdDecorations[0].options.dark.color).to.equal('started');
    expect(createdDecorations[0].options.light.color).to.equal('started');
  });
});
