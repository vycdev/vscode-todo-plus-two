import { expect } from 'chai';
import { flatMapFulfilled, mapFulfilled } from '../src/utils/promises';

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

    it('flattens fulfilled lists when another operation fails', async () => {
        const rejected: string[] = [];
        const results = await flatMapFulfilled(
            ['first', 'blocked', 'last'],
            async (value) => {
                if (value === 'blocked') throw new Error('permission denied');

                return [`${value}-1`, `${value}-2`];
            },
            (value) => rejected.push(value)
        );

        expect(results).to.deep.equal(['first-1', 'first-2', 'last-1', 'last-2']);
        expect(rejected).to.deep.equal(['blocked']);
    });
});
