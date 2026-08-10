import { expect } from 'chai';
import { mapFulfilled } from '../src/utils/promises';

describe('Promise helpers', () => {
    it('keeps fulfilled results when another operation fails', async () => {
        const rejected: string[] = [];
        const results = await mapFulfilled(
            ['first', 'blocked', 'last'],
            async (value) => {
                if (value === 'blocked') throw new Error('permission denied');

                return value.toUpperCase();
            },
            (value) => rejected.push(value)
        );

        expect(results).to.deep.equal(['FIRST', 'LAST']);
        expect(rejected).to.deep.equal(['blocked']);
    });

    it('preserves fulfilled undefined results', async () => {
        const results = await mapFulfilled([1], async () => undefined);

        expect(results).to.deep.equal([undefined]);
    });
});

describe('Promise rejection handler', () => {
    it('keeps fulfilled results when the rejection handler throws', async () => {
        const results = await mapFulfilled(
            ['first', 'blocked', 'last'],
            async (value) => {
                if (value === 'blocked') throw new Error('permission denied');
                return value.toUpperCase();
            },
            () => {
                throw new Error('logging failed');
            }
        );
        expect(results).to.deep.equal(['FIRST', 'LAST']);
    });
});
