import { expect } from 'chai';
import { applyCustomColors } from '../src/todo/decorators/theme-colors';

describe('Theme syntax colors', () => {
    const decorations = [
        {
            type: { name: 'custom-color' },
            ranges: [{ name: 'colored range' }],
        },
    ];

    it('keeps custom color decoration ranges when enabled', () => {
        expect(applyCustomColors(decorations, true)).to.equal(decorations);
    });

    it('clears custom color ranges while retaining their decoration types when disabled', () => {
        const [decoration] = applyCustomColors(decorations, false);

        expect(decoration.type).to.equal(decorations[0].type);
        expect(decoration.ranges).to.deep.equal([]);
        expect(decorations[0].ranges).to.have.length(1);
    });
});
