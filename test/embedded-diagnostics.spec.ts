import { expect } from 'chai';
import { getEmbeddedDiagnosticData, normalizeSeverityMap } from '../src/utils/embedded/diagnostics';

describe('Embedded todo diagnostics', () => {
    it('normalizes marker names and supported severities', () => {
        expect(
            normalizeSeverityMap({ todo: 'Warning', FIXME: 'error', NOTE: 'invalid' })
        ).to.deep.equal({
            TODO: 'warning',
            FIXME: 'error',
        });
    });

    it('creates diagnostics only for configured markers', () => {
        const diagnostics = getEmbeddedDiagnosticData(
            [
                {
                    type: 'TODO',
                    todo: '// TODO: finish this',
                    message: ' finish this',
                    rawLine: '    // TODO: finish this',
                    lineNr: 3,
                },
                {
                    type: 'NOTE',
                    todo: '// NOTE: context',
                    message: ' context',
                    rawLine: '// NOTE: context',
                    lineNr: 4,
                },
            ],
            { TODO: 'warning' }
        );

        expect(diagnostics).to.deep.equal([
            {
                line: 3,
                start: 7,
                end: 24,
                message: 'TODO: finish this',
                severity: 'warning',
            },
        ]);
    });

    it('supports diagnostics without a description', () => {
        expect(
            getEmbeddedDiagnosticData(
                [
                    {
                        type: 'FIXME',
                        todo: '# FIXME',
                        rawLine: '# FIXME',
                        lineNr: 0,
                    },
                ],
                { fixme: 'hint' }
            )
        ).to.deep.equal([
            {
                line: 0,
                start: 2,
                end: 7,
                message: 'FIXME',
                severity: 'hint',
            },
        ]);
    });

    it('uses parser offsets for identical markers on the same line', () => {
        const rawLine = '// TODO: same; // TODO: same';

        expect(
            getEmbeddedDiagnosticData(
                [
                    {
                        column: 15,
                        type: 'TODO',
                        todo: '// TODO: same',
                        message: ' same',
                        rawLine,
                        lineNr: 1,
                    },
                ],
                { TODO: 'info' }
            )[0]
        ).to.include({ start: 18, end: 28 });
    });
});
