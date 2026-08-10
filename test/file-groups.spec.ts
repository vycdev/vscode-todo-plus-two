import { expect } from 'chai';
import { getUniqueRootKeys } from '../src/utils/file-groups';

describe('Todo file root grouping', () => {
    it('keeps repeated files from a unique root label unchanged', () => {
        const roots = [
            { root: 'project', rootPath: '/workspace/project' },
            { root: 'project', rootPath: '/workspace/project' },
        ];

        expect(getUniqueRootKeys(roots)).to.deep.equal(['project', 'project']);
    });

    it('keeps same-named roots separate in a multi-root workspace', () => {
        const roots = [
            { root: 'project', rootPath: '/workspace/alpha' },
            { root: 'project', rootPath: '/workspace/beta' },
        ];

        expect(getUniqueRootKeys(roots)).to.deep.equal([
            'project (/workspace/alpha)',
            'project (/workspace/beta)',
        ]);
    });
});
