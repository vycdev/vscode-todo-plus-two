import { expect } from 'chai';
import { resetEmbeddedProvider } from '../src/utils/embedded/provider-lifecycle';

describe('Embedded provider lifecycle', () => {
    it('disposes and clears the provider while invalidating pending initialization', () => {
        let disposeCount = 0;
        const holder = {
            providerGeneration: 2,
            provider: {
                dispose() {
                    disposeCount += 1;
                },
            },
        };

        resetEmbeddedProvider(holder);

        expect(disposeCount).to.equal(1);
        expect(holder.provider).to.equal(undefined);
        expect(holder.providerGeneration).to.equal(3);
    });

    it('invalidates pending initialization when no provider exists yet', () => {
        const holder = { provider: undefined, providerGeneration: 0 };

        resetEmbeddedProvider(holder);

        expect(holder.provider).to.equal(undefined);
        expect(holder.providerGeneration).to.equal(1);
    });
});
