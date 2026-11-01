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
      '--',
      'TODO|FIXME',
      '/workspace/file.ts',
    ]);
  });

  it('keeps option-like search patterns and file paths after the option terminator', () => {
    const args = buildRgArgs('-TODO', ['--hidden'], ['--smart-case', '-notes.todo']);

    expect(args.slice(-4)).to.deep.equal(['--', '-TODO', '--smart-case', '-notes.todo']);
    expect(args.indexOf('--hidden')).to.be.lessThan(args.indexOf('--'));
  });
});
