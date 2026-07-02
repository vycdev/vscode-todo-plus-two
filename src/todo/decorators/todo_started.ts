/* IMPORT */

import * as vscode from 'vscode';
import Consts from '../../consts';
import TodoBoxItem from '../items/todo_box';
import Line from './line';

/* DECORATION TYPES */

let DECORATION_SIGNATURE: string;
let TODO_STARTED: vscode.TextEditorDecorationType;

function getDecorationSignature() {
    return JSON.stringify({
        started: Consts.colors.started,
        dark: Consts.colors.dark.started,
        light: Consts.colors.light.started,
    });
}

function ensureDecorationType() {
    const signature = getDecorationSignature();

    if (signature === DECORATION_SIGNATURE) return TODO_STARTED;

    if (TODO_STARTED) TODO_STARTED.dispose();

    TODO_STARTED = vscode.window.createTextEditorDecorationType({
        color: Consts.colors.started,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
        dark: {
            color: Consts.colors.dark.started || Consts.colors.started,
        },
        light: {
            color: Consts.colors.light.started || Consts.colors.started,
        },
    });

    DECORATION_SIGNATURE = signature;

    return TODO_STARTED;
}

/* TODO STARTED */

class TodoStarted extends Line {
    constructor() {
        super();

        this.TYPES = [ensureDecorationType()];
    }

    getItemRanges(todoStarted: TodoBoxItem, negRange?: vscode.Range | vscode.Range[]) {
        return [
            this.getRangeDifference(
                todoStarted.text,
                todoStarted.range,
                negRange || [Consts.regexes.tag, Consts.regexes.formattedCode]
            ),
        ];
    }
}

/* EXPORT */

export default TodoStarted;
