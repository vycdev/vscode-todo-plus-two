import { expect } from 'chai';
import { renderStatisticsTemplate } from '../src/utils/statistics-template';

const timeTokens = ['est', 'est-total', 'est-finished', 'lasted', 'wasted', 'elapsed'];

describe('Statistics template rendering', () => {
    it('renders empty time tokens as visible zero durations', () => {
        const tokens = {
            est: '',
            'est-total': '',
            'est-finished': '',
            lasted: '',
            wasted: '',
            elapsed: '',
        };

        expect(
            renderStatisticsTemplate(
                '[est]|[est-total]|[est-finished]|[lasted]|[wasted]|[elapsed]',
                tokens,
                timeTokens
            )
        ).to.equal('0s|0s|0s|0s|0s|0s');
    });

    it('preserves populated time token values', () => {
        const tokens = {
            est: '1h',
            'est-total': '2h',
            'est-finished': '3h',
            lasted: '4h',
            wasted: '5h',
            elapsed: '6h',
        };

        expect(
            renderStatisticsTemplate(
                '[est]|[est-total]|[est-finished]|[lasted]|[wasted]|[elapsed]',
                tokens,
                timeTokens
            )
        ).to.equal('1h|2h|3h|4h|5h|6h');
    });

    it('does not substitute zero-duration text for non-time tokens', () => {
        expect(
            renderStatisticsTemplate('[comments]|[pending]', { comments: '', pending: 0 }, [
                'comments',
                'pending',
            ])
        ).to.equal('|0');
    });

    it('replaces repeated tokens and preserves unsupported placeholders', () => {
        expect(renderStatisticsTemplate('[est]|[unknown]|[est]', { est: '' }, ['est'])).to.equal(
            '0s|[unknown]|0s'
        );
    });
});
