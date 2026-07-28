import { expect } from 'chai';
import { matchesFilesViewFilter } from '../src/utils/files-view-filter';

describe('Files view filter', () => {
    it('matches task text case-insensitively and treats the filter literally', () => {
        expect(matchesFilesViewFilter('URGENT', '/workspace/TODO', ['  ☐ urgent task'])).to.equal(
            true
        );
        expect(matchesFilesViewFilter('[api]', '/workspace/TODO', ['  ☐ fix [api]'])).to.equal(
            true
        );
        expect(matchesFilesViewFilter('[api]', '/workspace/TODO', ['  ☐ fix api'])).to.equal(false);
    });

    it('keeps ancestors when a descendant matches', () => {
        const branch = ['Project:', '  ☐ parent', '    ☐ matching child'];

        expect(matchesFilesViewFilter('matching child', '/workspace/TODO', branch)).to.equal(true);
    });

    it('shows every branch when the file path matches', () => {
        expect(
            matchesFilesViewFilter('client/todo', '/workspace/client/TODO', [
                'Unrelated:',
                '  ☐ task',
            ])
        ).to.equal(true);
    });

    it('allows every branch when filtering is inactive', () => {
        expect(matchesFilesViewFilter(false, '/workspace/TODO', ['Project:'])).to.equal(true);
    });
});
