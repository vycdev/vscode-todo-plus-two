import { expect } from 'chai';
import { matchesEmbeddedFilter } from '../src/utils/embedded/filter';

describe('Embedded todo filter', () => {
    it('matches visible context when the todo line and file path do not match', () => {
        expect(
            matchesEmbeddedFilter(
                /deploy/i,
                '/workspace/src/service.ts',
                '// TODO update the service',
                'Deploy after the migration completes'
            )
        ).to.equal(true);
    });

    it('keeps matching todo lines and file paths', () => {
        expect(
            matchesEmbeddedFilter(
                /service/i,
                '/workspace/src/service.ts',
                '// TODO update the service',
                undefined
            )
        ).to.equal(true);
        expect(
            matchesEmbeddedFilter(
                /service/i,
                '/workspace/src/service.ts',
                '// TODO update it',
                undefined
            )
        ).to.equal(true);
    });

    it('does not match unrelated context', () => {
        expect(
            matchesEmbeddedFilter(
                /deploy/i,
                '/workspace/src/service.ts',
                '// TODO update the service',
                'Run the unit tests'
            )
        ).to.equal(false);
    });
});
