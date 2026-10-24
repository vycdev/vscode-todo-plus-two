/* IMPORT */

import * as vscode from 'vscode';

/* COMMAND */

const Command = {
  bindings: new Map<string, { args: any[]; disposable: vscode.Disposable }>(),

  get(command, args) {
    if (!args) return command;

    // The status bar has one current target per command. Updating that target must
    // not register a new command for every file/line the timer has ever displayed.
    const id = `todo.proxy.${command}`;
    const binding = Command.bindings.get(command);
    if (binding) {
      binding.args = args;
    } else {
      const current = {
        args,
        disposable: vscode.commands.registerCommand(id, () =>
          vscode.commands.executeCommand(command, ...current.args)
        ),
      };
      Command.bindings.set(command, current);
    }
    return id;
  },

  dispose() {
    Command.bindings.forEach(({ disposable }) => disposable.dispose());
    Command.bindings.clear();
  },
};

/* EXPORT */

export default Command;
