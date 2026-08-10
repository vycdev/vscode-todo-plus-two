import { expect } from 'chai';
import Regex from '../src/utils/regex';

describe('Regex utilities', () => {
    it('ranges the final capture when its text repeats earlier in the full match', () => {
        const match = /(foo)(foo)/.exec('foofoo')!;

        expect(Regex.match2range(match)).to.deep.equal({ start: 3, end: 6 });
    });
});
