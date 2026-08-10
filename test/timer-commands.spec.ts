import { expect } from 'chai';

const pkg = require('../package.json');

describe('Timer command contributions', () => {
    it('contributes separate task and status bar timer commands', () => {
        const commands = pkg.contributes.commands.reduce((titles, command) => {
            titles[command.command] = command.title;
            return titles;
        }, {});

        expect(commands['todo.toggleTimer']).to.equal('Todo: Toggle Timer');
        expect(commands['todo.toggleStatusBarTimer']).to.equal('Todo: Toggle Status Bar Timer');
        expect(pkg.activationEvents).to.include('onCommand:todo.toggleStatusBarTimer');
    });

    it('binds Alt+T to task timer toggling in Todo editors', () => {
        const keybinding = pkg.contributes.keybindings.find(
            ({ command }) => command === 'todo.toggleTimer'
        );

        expect(keybinding).to.deep.include({
            key: 'Alt+t',
            when: 'editorTextFocus && editorLangId == todo',
        });
    });
});
