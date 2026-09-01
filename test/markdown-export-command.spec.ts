import { expect } from 'chai';

const pkg = require('../package.json');

describe('Markdown export command contribution', () => {
    it('contributes and activates the Markdown export command', () => {
        const command = pkg.contributes.commands.find(
            ({ command }) => command === 'todo.exportMarkdown'
        );

        expect(command).to.deep.include({
            command: 'todo.exportMarkdown',
            title: 'Todo: Export to Markdown',
        });
        expect(pkg.activationEvents).to.include('onCommand:todo.exportMarkdown');
    });
});
