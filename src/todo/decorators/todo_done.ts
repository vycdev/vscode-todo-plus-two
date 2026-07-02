/* IMPORT */

import * as vscode from 'vscode';
import Config from '../../config';
import Consts from '../../consts';
import TodoDoneItem from '../items/todo_done';
import Line from './line';

/* DECORATION TYPES */

const TODO_DONE_OPTIONS = {
    color: Consts.colors.done,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    dark: {
        color: Consts.colors.dark.done,
    },
    light: {
        color: Consts.colors.light.done,
    },
};

const TODO_DONE = vscode.window.createTextEditorDecorationType(TODO_DONE_OPTIONS);

const TODO_DONE_STRIKETHROUGH = vscode.window.createTextEditorDecorationType({
    ...TODO_DONE_OPTIONS,
    textDecoration: 'line-through',
});

/* TODO DONE */

class TodoDone extends Line {
    TYPES = [TODO_DONE, TODO_DONE_STRIKETHROUGH];

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
            strikethrough = Config.getKey('decorations.done.strikethrough') !== false;

        return [
            {
                type: TODO_DONE,
                ranges: strikethrough ? [] : ranges,
            },
            {
                type: TODO_DONE_STRIKETHROUGH,
                ranges: strikethrough ? ranges : [],
            },
        ];
    }
}

/* EXPORT */

export default TodoDone;
