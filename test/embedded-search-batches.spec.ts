import { expect } from 'chai';
import { getSearchFileBatches } from '../src/utils/embedded/search-batches';

describe('External embedded search batches', () => {
  it('limits the number of files without dropping paths', () => {
    expect(getSearchFileBatches(['a', 'b', 'c', 'd', 'e'], 2)).to.deep.equal([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
    expect(getSearchFileBatches([], 50)).to.deep.equal([]);
  });

  it('bounds command length even when the configured batch is large', () => {
    const files = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)];
    expect(getSearchFileBatches(files, 1000, 300)).to.deep.equal(files.map((file) => [file]));
  });
});
