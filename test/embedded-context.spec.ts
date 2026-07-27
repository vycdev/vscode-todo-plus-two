import { expect } from 'chai';
import { getFollowingContext } from '../src/utils/embedded/context';

describe('Embedded todo context', () => {
    const isEmbeddedTodo = (line: string) => /\b(?:TODO|FIXME)\b/i.test(line);

    it('returns the source line immediately following an embedded todo', () => {
        const lines = ['// TODO: simplify this', '  const result = buildValue();'];

        expect(getFollowingContext(lines, 0, isEmbeddedTodo)).to.equal(
            'const result = buildValue();'
        );
    });

    it('does not use another embedded todo as context', () => {
        const lines = ['// TODO: first', '// FIXME: second', 'const result = buildValue();'];

        expect(getFollowingContext(lines, 0, isEmbeddedTodo)).to.equal(undefined);
    });

    it('does not skip blank lines to find context', () => {
        const lines = ['// TODO: simplify this', '   ', 'const result = buildValue();'];

        expect(getFollowingContext(lines, 0, isEmbeddedTodo)).to.equal(undefined);
    });

    it('returns no context at the end of a file', () => {
        expect(getFollowingContext(['// TODO: simplify this'], 0, isEmbeddedTodo)).to.equal(
            undefined
        );
    });
});
