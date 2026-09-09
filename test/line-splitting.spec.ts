import { expect } from 'chai';
import { splitLines } from '../src/utils/line-splitting';

describe('Line splitting', () => {
    it('preserves line boundaries across mixed newline styles', () => {
        expect(splitLines('first\r\nsecond\nthird\rfourth\r\n')).to.deep.equal([
            'first',
            'second',
            'third',
            'fourth',
            '',
        ]);
    });
});
