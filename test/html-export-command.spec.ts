import { expect } from 'chai';

const pkg = require('../package.json');

describe('HTML export command contribution', () => {
    it('contributes and activates the HTML export command', () => {
        const command = pkg.contributes.commands.find(
            ({ command }) => command === 'todo.exportHtml'
        );

        expect(command).to.deep.include({
            command: 'todo.exportHtml',
            title: 'Todo: Export to HTML',
        });
        expect(pkg.activationEvents).to.include('onCommand:todo.exportHtml');
    });
});
