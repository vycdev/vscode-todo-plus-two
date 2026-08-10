import { expect } from 'chai';
import { getTagPaletteColor } from '../src/utils/tag-colors';

describe('Tag colors', () => {
    it('uses the color at the matching tag index', () => {
        expect(getTagPaletteColor(['red', 'orange'], 0)).to.equal('red');
        expect(getTagPaletteColor(['red', 'orange'], 1)).to.equal('orange');
    });

    it('repeats shorter palettes across additional tags', () => {
        expect(getTagPaletteColor(['red', 'orange'], 2)).to.equal('red');
        expect(getTagPaletteColor(['red', 'orange'], 5)).to.equal('orange');
    });

    it('leaves tags without a color when the palette is empty', () => {
        expect(getTagPaletteColor([], 0)).to.equal(undefined);
    });
});
