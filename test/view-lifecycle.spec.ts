import { expect } from 'chai';
import { registerViews } from '../src/utils/view-lifecycle';

describe('View lifecycle', () => {
    it('registers view and configuration disposables with the extension context', () => {
        const disposed: string[] = [];
        const refreshed: string[] = [];
        const context = { subscriptions: [] };
        const views = [
            { id: 'files', refresh: () => refreshed.push('files') },
            { id: 'embedded', refresh: () => refreshed.push('embedded') },
        ];
        let configurationListener: () => void;

        registerViews(
            context,
            views,
            (id) => ({ dispose: () => disposed.push(id) }),
            (listener) => {
                configurationListener = listener;

                return { dispose: () => disposed.push('configuration') };
            }
        );

        expect(context.subscriptions).to.have.length(3);

        configurationListener!();
        expect(refreshed).to.deep.equal(['files', 'embedded']);

        context.subscriptions.forEach((subscription) => subscription.dispose());
        expect(disposed).to.deep.equal(['files', 'embedded', 'configuration']);
    });
});
