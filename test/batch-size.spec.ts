import { expect } from 'chai';
import { getBatchSize } from '../src/utils/batch-size';

describe('Batch size configuration', () => {
    it('normalizes invalid values to a positive integer fallback', () => {
        [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'invalid'].forEach((value) => {
            expect(getBatchSize(value)).to.equal(50);
        });
    });

    it('floors positive fractional values', () => {
        expect(getBatchSize(2.9)).to.equal(2);
    });
});
