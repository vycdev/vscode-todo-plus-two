import { expect } from 'chai';

const pkg = require('../package.json');

describe('Todo files view context menus', () => {
    const commands = [
        'todo.viewRevealTodo',
        'todo.viewToggleBox',
        'todo.viewToggleDone',
        'todo.viewToggleCancelled',
        'todo.viewToggleStart',
    ];

    it('contributes task actions for Todo files view items', () => {
        const contributedCommands = pkg.contributes.commands.map(({ command }) => command);
        const contextMenus = pkg.contributes.menus['view/item/context'];

        commands.forEach((command) => {
            expect(pkg.activationEvents).to.include(`onCommand:${command}`);
            expect(contributedCommands).to.include(command);
            expect(contextMenus).to.deep.include({
                command,
                when: 'view == todo.views.1files && viewItem == todo',
                group:
                    command === 'todo.viewRevealTodo'
                        ? 'navigation@1'
                        : `1_status@${commands.indexOf(command)}`,
            });
        });
    });

    it('does not expose status-changing actions in the embedded view', () => {
        const contextMenus = pkg.contributes.menus['view/item/context'];

        commands.slice(1).forEach((command) => {
            const menu = contextMenus.find((candidate) => candidate.command === command);

            expect(menu.when).to.equal('view == todo.views.1files && viewItem == todo');
        });
    });
});
