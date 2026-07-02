/* IMPORT */

import * as vscode from 'vscode';
import Config from '../../config';
import Consts from '../../consts';
import Due from '../../utils/due';
import TagItem from '../items/tag';
import Line from './line';

/* DECORATION TYPES */

let DECORATIONS_SIGNATURE: string;
let DUE_TYPES: vscode.TextEditorDecorationType[] = [];

function getColor(status: string, theme?: string) {
    return theme
        ? Consts.colors[theme].due[status] || Consts.colors.due[status]
        : Consts.colors.due[status];
}

function getDecorationSignature() {
    return JSON.stringify({
        due: Consts.colors.due,
        dark: Consts.colors.dark.due,
        light: Consts.colors.light.due,
    });
}

function ensureDecorationTypes() {
    const signature = getDecorationSignature();

    if (signature === DECORATIONS_SIGNATURE) return DUE_TYPES;

    DUE_TYPES.forEach((type) => type.dispose());

    DUE_TYPES = Due.statuses.map((status) =>
        vscode.window.createTextEditorDecorationType({
            color: getColor(status),
            fontWeight: 'bold',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            dark: {
                color: getColor(status, 'dark'),
            },
            light: {
                color: getColor(status, 'light'),
            },
        })
    );

    DECORATIONS_SIGNATURE = signature;

    return DUE_TYPES;
}

/* TODO DUE */

class TodoDue extends Line {
    constructor() {
        super();

        this.TYPES = ensureDecorationTypes();
    }

    getItemRanges(tag: TagItem) {
        const status = Due.statusFromTag(tag.text, new Date(), Config.getKey('due.soonDays')),
            index = Due.statuses.indexOf(status);

        return Due.statuses.map((_, typeIndex) => typeIndex === index && tag.range);
    }
}

/* EXPORT */

export default TodoDue;
