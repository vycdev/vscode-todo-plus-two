import { expect } from 'chai';

const pkg = require('../package.json');

describe('Todo configuration schema', () => {
    it('accepts supported timer statusbar modes', () => {
        const enabled = pkg.contributes.configuration.properties['todo.timer.statusbar.enabled'];

        expect(enabled.type).to.deep.equal(['boolean', 'string']);
        expect(enabled.enum).to.deep.equal([true, false, 'estimate']);
        expect(enabled.enum).to.include(enabled.default);
    });

    it('accepts numeric timer statusbar priorities', () => {
        const priority = pkg.contributes.configuration.properties['todo.timer.statusbar.priority'];

        expect(priority.type).to.equal('number');
        expect(priority.default).to.be.a('number');
    });

    it('accepts automatic embedded provider selection', () => {
        const provider = pkg.contributes.configuration.properties['todo.embedded.provider'];

        expect(provider.enum).to.include(provider.default);
    });
});
