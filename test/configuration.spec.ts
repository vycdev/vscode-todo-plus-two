import { expect } from 'chai';

const pkg = require('../package.json');

describe('Todo configuration schema', () => {
    it('accepts numeric timer statusbar priorities', () => {
        const priority = pkg.contributes.configuration.properties['todo.timer.statusbar.priority'];

        expect(priority.type).to.equal('number');
        expect(priority.default).to.be.a('number');
    });
});
