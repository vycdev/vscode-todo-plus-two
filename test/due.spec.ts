import { expect } from 'chai';
import Due from '../src/utils/due';

describe('Due utilities', () => {
    const today = new Date(2026, 6, 2);

    it('extracts date text from @due tags', () => {
        expect(Due.extract('@due(2026-07-02)')).to.equal('2026-07-02');
    });

    it('classifies overdue, today, soon, and later due dates', () => {
        expect(Due.status('2026-07-01', today, 7)).to.equal('overdue');
        expect(Due.status('2026-07-02', today, 7)).to.equal('today');
        expect(Due.status('2026-07-08', today, 7)).to.equal('soon');
        expect(Due.status('2026-07-20', today, 7)).to.equal('later');
    });

    it('supports the existing short timestamp format', () => {
        expect(Due.status('26-07-02 10:30', today, 7)).to.equal('today');
    });
});
