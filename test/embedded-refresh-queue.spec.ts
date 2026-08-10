import { expect } from 'chai';
import { enqueueEmbeddedRefresh } from '../src/utils/embedded/provider-lifecycle';

describe('Embedded refresh queue', () => {
    it('serializes refreshes and continues after a failed refresh', async () => {
        const queue = { current: Promise.resolve() };
        const events: string[] = [];
        let releaseFirst: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = enqueueEmbeddedRefresh(queue, async () => {
            events.push('first-start');
            await firstGate;
            events.push('first-end');
            throw new Error('first refresh failed');
        });
        const second = enqueueEmbeddedRefresh(queue, async () => {
            events.push('second');
        });

        await Promise.resolve();
        expect(events).to.deep.equal(['first-start']);

        releaseFirst!();
        await first.catch(() => undefined);
        await second;

        expect(events).to.deep.equal(['first-start', 'first-end', 'second']);
    });
});
