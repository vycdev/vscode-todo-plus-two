import { expect } from 'chai';
import { createEmbeddedOrder, getEmbeddedTodoKeys } from '../src/utils/embedded/order';

const makeStorage = (initial: unknown = undefined) => {
  let saved: any = initial;
  const writes: unknown[] = [];
  return {
    writes,
    get: () => saved,
    update: async (_key, value) => {
      saved = JSON.parse(JSON.stringify(value));
      writes.push(saved);
    },
  };
};

describe('Embedded manual ordering', () => {
  it('persists sibling moves across reloads without affecting another parent', async () => {
    const storage = makeStorage(),
      order = createEmbeddedOrder(storage);
    await order.move('types', ['HIGH', 'NEXT', 'NOW'], 'NOW', -1);
    const reloaded = createEmbeddedOrder(storage);
    expect(reloaded.apply('types', ['HIGH', 'NEXT', 'NOW'])).to.deep.equal(['HIGH', 'NOW', 'NEXT']);
    expect(reloaded.apply('another-root', ['HIGH', 'NEXT', 'NOW'])).to.deep.equal([
      'HIGH',
      'NEXT',
      'NOW',
    ]);
    expect(reloaded.apply('types', ['HIGH', 'LATER', 'NEXT', 'NOW'])).to.deep.equal([
      'HIGH',
      'NOW',
      'NEXT',
      'LATER',
    ]);
  });

  it('retains absent ranks, including when remaining entries are moved', async () => {
    const order = createEmbeddedOrder(makeStorage());
    await order.move('tasks', ['a', 'b', 'c'], 'b', -1);
    expect(order.apply('tasks', ['a', 'c'])).to.deep.equal(['a', 'c']);
    await order.move('tasks', ['a', 'c'], 'c', -1);
    expect(order.apply('tasks', ['a', 'b', 'c'])).to.deep.equal(['b', 'c', 'a']);
  });

  it('does not write for boundary moves or unknown entries', async () => {
    const storage = makeStorage(),
      order = createEmbeddedOrder(storage);
    expect(await order.move('tasks', ['a', 'b'], 'a', -1)).to.equal(false);
    expect(await order.move('tasks', ['a', 'b'], 'b', 1)).to.equal(false);
    expect(await order.move('tasks', ['a', 'b'], 'missing', 1)).to.equal(false);
    expect(await order.moveTo('tasks', ['a', 'b'], 'a', 'missing')).to.equal(false);
    expect(await order.moveTo('tasks', ['a', 'b'], 'a', 'a')).to.equal(false);
    expect(storage.writes).to.deep.equal([]);
  });

  it('moves across multiple siblings in either direction and can reach the end', async () => {
    const storage = makeStorage(),
      order = createEmbeddedOrder(storage),
      keys = ['a', 'b', 'c', 'd'];
    await order.moveTo('tasks', keys, 'd', 'a');
    expect(order.apply('tasks', keys)).to.deep.equal(['d', 'a', 'b', 'c']);
    await order.moveTo('tasks', keys, 'd', 'c');
    expect(createEmbeddedOrder(storage).apply('tasks', keys)).to.deep.equal(keys);
  });

  it('resets ranks for all parents and grouping layouts', async () => {
    const storage = makeStorage(),
      order = createEmbeddedOrder(storage);
    await order.move('types', ['a', 'b'], 'b', -1);
    await order.move('files', ['a', 'b'], 'b', -1);
    await order.reset();
    const reloaded = createEmbeddedOrder(storage);
    expect(reloaded.apply('types', ['a', 'b'])).to.deep.equal(['a', 'b']);
    expect(reloaded.apply('files', ['a', 'b'])).to.deep.equal(['a', 'b']);
  });

  it('does not apply a failed persistence update', async () => {
    const storage = makeStorage();
    storage.update = async () => {
      throw new Error('Storage unavailable');
    };
    const order = createEmbeddedOrder(storage);
    try {
      await order.move('tasks', ['a', 'b'], 'b', -1);
      expect.fail('Expected a storage failure');
    } catch (error) {
      expect(error.message).to.equal('Storage unavailable');
    }
    expect(order.apply('tasks', ['a', 'b'])).to.deep.equal(['a', 'b']);
  });

  it('ignores malformed stored ranks and deduplicates valid ones', () => {
    const order = createEmbeddedOrder(makeStorage({ good: ['b', 'b', 'a'], bad: ['a', 2] }));
    expect(order.apply('good', ['a', 'b'])).to.deep.equal(['b', 'a']);
    expect(order.apply('bad', ['a', 'b'])).to.deep.equal(['a', 'b']);
  });
});

describe('Embedded todo identities', () => {
  const todo = { filePath: '/workspace/app.ts', type: 'TODO', todo: '// TODO first' };

  it('survives source-line, column, context, and label changes', () => {
    const original = { ...todo, lineNr: 1, column: 0, message: 'first', context: 'old()' },
      edited = {
        ...original,
        lineNr: 20,
        column: 4,
        message: 'shown differently',
        context: 'new()',
      };
    expect(getEmbeddedTodoKeys([original])).to.deep.equal(getEmbeddedTodoKeys([edited]));
  });

  it('distinguishes duplicate occurrences, files, and changed comment text', () => {
    const keys = getEmbeddedTodoKeys([
      todo,
      todo,
      { ...todo, filePath: '/other/app.ts' },
      { ...todo, todo: '// TODO changed' },
    ]);
    expect(new Set(keys).size).to.equal(4);
    expect(keys[0]).to.equal(getEmbeddedTodoKeys([todo])[0]);
  });

  it('normalizes Windows path separators', () => {
    expect(getEmbeddedTodoKeys([{ ...todo, filePath: 'C:\\work\\app.ts' }])).to.deep.equal(
      getEmbeddedTodoKeys([{ ...todo, filePath: 'C:/work/app.ts' }])
    );
  });
});

describe('Embedded manual ordering contributions', () => {
  const pkg = require('../package.json');

  it('keeps line ordering as the default and contributes all manual-order commands', () => {
    const sort = pkg.contributes.configuration.properties['todo.embedded.view.sort'];
    expect(sort.enum).to.deep.equal(['line', 'label', 'manual']);
    expect(sort.default).to.equal('line');
    for (const command of [
      'viewEmbeddedMoveUp',
      'viewEmbeddedMoveDown',
      'viewEmbeddedResetOrder',
    ]) {
      expect(pkg.activationEvents).to.include(`onCommand:todo.${command}`);
      expect(
        pkg.contributes.commands.some((entry) => entry.command === `todo.${command}`)
      ).to.equal(true);
    }
  });

  it('only exposes moves on embedded siblings in the full, unfiltered manual view', () => {
    for (const command of ['viewEmbeddedMoveUp', 'viewEmbeddedMoveDown']) {
      const menu = pkg.contributes.menus['view/item/context'].find(
        (entry) => entry.command === `todo.${command}`
      );
      expect(menu.when).to.equal(
        'view == todo.views.2embedded && config.todo.embedded.view.sort == manual && todo-embedded-filtered == false && todo-embedded-all == true && viewItem =~ /^(group|file|todo)$/'
      );
      expect(pkg.contributes.menus.commandPalette).to.deep.include({
        command: `todo.${command}`,
        when: 'false',
      });
    }
    expect(pkg.contributes.menus['view/title']).to.deep.include({
      command: 'todo.viewEmbeddedResetOrder',
      when: 'view == todo.views.2embedded && config.todo.embedded.view.sort == manual',
      group: '2_sort',
    });
  });
});
