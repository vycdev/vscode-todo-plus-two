/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Consts from '../consts';
import * as Commands from '../commands';
import Config from '../config';
import Views from '../views';
import { getAutomaticSymbolRule } from './automatic_symbol';

/* INIT */

const Init = {
    commands(context: vscode.ExtensionContext) {
        const { commands } = vscode.extensions.getExtension('vycdev.vscode-todo-plus-two')
            .packageJSON.contributes;

        commands.forEach(({ command, title }) => {
            const commandName = _.last(command.split('.')) as string,
                handler = Commands[commandName],
                disposable = vscode.commands.registerCommand(command, handler);

            context.subscriptions.push(disposable);
        });

        return Commands;
    },

    language(context: vscode.ExtensionContext) {
        let languageDisposable: vscode.Disposable;

        const update = () => {
            if (languageDisposable) languageDisposable.dispose();

            Consts.update();

            const automaticSymbolRule = Config.getKey('automaticSymbol')
                ? getAutomaticSymbolRule(Consts.symbols)
                : undefined;

            languageDisposable = vscode.languages.setLanguageConfiguration(Consts.languageId, {
                wordPattern:
                    /(-?\d*\.\d\w*)|([^\-\`\~\!\#\%\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
                indentationRules: {
                    increaseIndentPattern: Consts.regexes.project,
                    decreaseIndentPattern: Consts.regexes.impossible,
                },
                onEnterRules: automaticSymbolRule
                    ? [
                          {
                              beforeText: automaticSymbolRule.beforeText,
                              afterText: automaticSymbolRule.afterText,
                              action: {
                                  indentAction: vscode.IndentAction.None,
                                  appendText: automaticSymbolRule.appendText,
                              },
                          },
                      ]
                    : [],
            });
        };

        const configurationDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration('todo.automaticSymbol') ||
                event.affectsConfiguration('todo.symbols')
            ) {
                update();
            }
        });

        update();

        context.subscriptions.push(configurationDisposable, {
            dispose: () => languageDisposable && languageDisposable.dispose(),
        });
    },

    views() {
        Views.forEach((View) => {
            vscode.window.registerTreeDataProvider(View.id, View);
        });

        vscode.workspace.onDidChangeConfiguration(() => {
            Views.forEach((View) => View.refresh());
        });
    },
};

/* EXPORT */

export default Init;
