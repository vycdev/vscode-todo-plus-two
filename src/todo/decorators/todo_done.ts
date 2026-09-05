/* IMPORT */

import * as vscode from 'vscode';
import Config from '../../config';
import Consts from '../../consts';
import TodoDoneItem from '../items/todo_done';
import Line from './line';

/* DECORATION TYPES */

let DECORATIONS_SIGNATURE: string;
let TODO_DONE: vscode.TextEditorDecorationType;
let TODO_DONE_STRIKETHROUGH: vscode.TextEditorDecorationType;

function getDecorationSignature() {
    return JSON.stringify({
        enabled: Config.getKey('colors.enabled') !== false,
        done: Consts.colors.done,
        dark: Consts.colors.dark.done,
        light: Consts.colors.light.done,
    });
}

function ensureDecorationTypes() {
    const signature = getDecorationSignature();

    if (signature === DECORATIONS_SIGNATURE) return [TODO_DONE, TODO_DONE_STRIKETHROUGH];

    if (TODO_DONE) TODO_DONE.dispose();
    if (TODO_DONE_STRIKETHROUGH) TODO_DONE_STRIKETHROUGH.dispose();

    const options: any = {
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    };

    if (Config.getKey('colors.enabled') !== false) {
        options.color = Consts.colors.done;
        options.dark = { color: Consts.colors.dark.done };
        options.light = { color: Consts.colors.light.done };
    }

    TODO_DONE = vscode.window.createTextEditorDecorationType(options);
    TODO_DONE_STRIKETHROUGH = vscode.window.createTextEditorDecorationType({
        ...options,
        textDecoration: 'line-through',
    });
    DECORATIONS_SIGNATURE = signature;

    return [TODO_DONE, TODO_DONE_STRIKETHROUGH];
}

/* TODO DONE */

class TodoDone extends Line {
    constructor() {
        super();

        this.TYPES = ensureDecorationTypes();
    }

    getItemRanges(todoDone: TodoDoneItem, negRange?: vscode.Range | vscode.Range[]) {
        return [
            this.getRangeDifference(
                todoDone.text,
                todoDone.range,
                negRange || [Consts.regexes.tag, Consts.regexes.formattedCode]
            ),
        ];
    }

    getDecorations(todosDone: TodoDoneItem[], negRange?: vscode.Range | vscode.Range[]) {
        const ranges = this.getItemsRanges(todosDone, negRange)[0] || [],
            strikethrough = Config.getKey('decorations.done.strikethrough') !== false,
            types = ensureDecorationTypes();

        return [
            {
                type: types[0],
                ranges: strikethrough ? [] : ranges,
            },
            {
                type: types[1],
                ranges: strikethrough ? ranges : [],
            },
        ];
    }
}

/* EXPORT */

export default TodoDone;
