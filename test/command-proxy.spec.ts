import { expect } from 'chai';

describe('Status bar command proxy lifecycle', () => {
  it('reuses a proxy with the current target, returns its result, and disposes it', async () => {
    const NodeModule = require('module');
    const originalLoad = NodeModule._load;
    const modulePath = require.resolve('../src/utils/command');
    const previous = require.cache[modulePath];
    const handlers: any[] = [];
    const calls: any[] = [];
    let disposed = 0;
    NodeModule._load = (request, parent, isMain) => {
      if (request === 'vscode' && parent.filename === modulePath)
        return {
          commands: {
            registerCommand: (_id, handler) => {
              handlers.push(handler);
              return { dispose: () => disposed++ };
            },
            executeCommand: async (...args) => {
              calls.push(args);
              return 'opened';
            },
          },
        };
      return originalLoad(request, parent, isMain);
    };
    let command;
    try {
      delete require.cache[modulePath];
      command = require(modulePath).default;
    } finally {
      NodeModule._load = originalLoad;
      if (previous) require.cache[modulePath] = previous;
      else delete require.cache[modulePath];
    }
    const id = command.get('todo.open', ['/first/TODO', 2]);
    expect(command.get('todo.open', ['/second/TODO', 7])).to.equal(id);
    expect(handlers.length).to.equal(1);
    expect(await handlers[0]()).to.equal('opened');
    expect(calls).to.deep.equal([['todo.open', '/second/TODO', 7]]);
    command.dispose();
    expect(disposed).to.equal(1);
    expect(command.bindings.size).to.equal(0);
  });
});
