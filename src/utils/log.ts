/* IMPORT */
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

function getChannel() {
    if (!channel) channel = vscode.window.createOutputChannel('Todo+');
    return channel;
}

function debug(message: string) {
    try {
        const ch = getChannel();
        ch.appendLine(`[debug] ${message}`);
    } catch (e) {
        // no-op
    }
}

function info(message: string) {
    try {
        const ch = getChannel();
        ch.appendLine(message);
    } catch (e) {
        // no-op
    }
}

export default { debug, info, getChannel };
