import { expect } from 'chai';
import { getEstimateDuration, tagEstimateRegex } from '../src/utils/estimate';

describe('Estimate tags', () => {
    it('ignores numeric-looking tags without duration units', () => {
        expect(getEstimateDuration('@1.')).to.equal(undefined);
        expect(getEstimateDuration('@123,')).to.equal(undefined);
        expect(getEstimateDuration('@1h-foo')).to.equal(undefined);
        expect(getEstimateDuration('@1h.foo')).to.equal(undefined);
    });

    it('recognizes compact and explicit estimates', () => {
        expect(getEstimateDuration('@1h')).to.equal('1h');
        expect(getEstimateDuration('@1h20m')).to.equal('1h20m');
        expect(getEstimateDuration('@1.5hours')).to.equal('1.5hours');
        expect(getEstimateDuration('@est(3 hours)')).to.equal('3 hours');
    });

    it('uses the same strict matching when locating an estimate in todo text', () => {
        expect('Task @1.'.match(tagEstimateRegex)).to.equal(null);
        expect(getEstimateDuration('Task @2h30m next')).to.equal('2h30m');
    });
});
