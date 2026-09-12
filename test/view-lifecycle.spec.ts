import { expect } from 'chai';
import { registerViews } from '../src/utils/view-lifecycle';

describe('View lifecycle', () => {
  it('registers view and configuration disposables with the extension context', () => {
    const disposed: string[] = [];
    const refreshed: string[] = [];
    const treeViews: string[] = [];
    const context = { subscriptions: [] };
    const views = [
      {
        id: 'files',
        refresh: () => refreshed.push('files'),
        setTreeView: (treeView) => treeViews.push(treeView.id),
      },
      { id: 'embedded', refresh: () => refreshed.push('embedded') },
    ];
    let configurationListener: () => void;

    registerViews(
      context,
      views,
      (id) => ({ id, dispose: () => disposed.push(id) }),
      (listener) => {
        configurationListener = listener;

        return { dispose: () => disposed.push('configuration') };
      }
    );

    expect(context.subscriptions).to.have.length(3);
    expect(treeViews).to.deep.equal(['files']);

    configurationListener!();
    expect(refreshed).to.deep.equal(['files', 'embedded']);

    context.subscriptions.forEach((subscription) => subscription.dispose());
    expect(disposed).to.deep.equal(['files', 'embedded', 'configuration']);
  });

  it('also disposes resources owned by view providers', () => {
    const disposed: string[] = [];
    const context = { subscriptions: [] };

    registerViews(
      context,
      [
        {
          id: 'due',
          refresh: () => undefined,
          setTreeView: () => disposed.push('bound-tree-view'),
          dispose: () => disposed.push('view-resources'),
        },
      ],
      () => ({ dispose: () => disposed.push('registration') }),
      () => ({ dispose: () => disposed.push('configuration') })
    );

    context.subscriptions.forEach((subscription) => subscription.dispose());
    expect(disposed).to.deep.equal([
      'bound-tree-view',
      'registration',
      'configuration',
      'view-resources',
    ]);
  });
});
