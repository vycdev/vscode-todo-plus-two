import { expect } from 'chai';
import { buildRgArgs } from '../src/utils/embedded/rg-args';

describe('Ripgrep provider arguments', () => {
    it('enforces the heading format expected by the Ackmate parser', () => {
        expect(buildRgArgs('TODO|FIXME', ['--pretty'], ['/workspace/file.ts'])).to.deep.equal([
            '--pretty',
            '--color',
            'never',
            '--with-filename',
            '--heading',
            '--line-number',
            'TODO|FIXME',
            '/workspace/file.ts',
        ]);
    });
});
