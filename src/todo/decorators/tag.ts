/* IMPORT */

import * as vscode from 'vscode';
import Consts from '../../consts';
import TagItem from '../items/tag';
import Line from './line';

/* DECORATION TYPES */

let DECORATIONS_SIGNATURE: string;
let SPECIAL_TAGS: vscode.TextEditorDecorationType[] = [];
let TAG: vscode.TextEditorDecorationType;
let ID: vscode.TextEditorDecorationType;
let DEPENDENCY: vscode.TextEditorDecorationType;

function getDecorationSignature() {
    return JSON.stringify({
        names: Consts.tags.names,
        colors: {
            tag: Consts.colors.tag,
            id: Consts.colors.id,
            dependency: Consts.colors.dependency,
            tags: Consts.colors.tags,
            dark: {
                tag: Consts.colors.dark.tag,
                id: Consts.colors.dark.id,
                dependency: Consts.colors.dark.dependency,
                tags: Consts.colors.dark.tags,
            },
            light: {
                tag: Consts.colors.light.tag,
                id: Consts.colors.light.id,
                dependency: Consts.colors.light.dependency,
                tags: Consts.colors.light.tags,
            },
        },
    });
}

function disposeDecorationTypes(types: vscode.TextEditorDecorationType[]) {
    types.forEach((type) => type && type.dispose());
}

function ensureDecorationTypes() {
    const signature = getDecorationSignature();

    if (signature === DECORATIONS_SIGNATURE) {
        return { special: SPECIAL_TAGS, tag: TAG, id: ID, dependency: DEPENDENCY };
    }

    disposeDecorationTypes([...SPECIAL_TAGS, TAG, ID, DEPENDENCY]);

    SPECIAL_TAGS = Consts.tags.names.map((name, index) =>
        vscode.window.createTextEditorDecorationType({
            backgroundColor: Consts.colors.tags.background[index],
            color: Consts.colors.tags.foreground[index] || Consts.colors.tag,
            borderRadius: '2px',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            dark: {
                backgroundColor:
                    Consts.colors.dark.tags.background[index] ||
                    Consts.colors.tags.background[index],
                color:
                    Consts.colors.dark.tags.foreground[index] ||
                    Consts.colors.tags.foreground[index] ||
                    Consts.colors.dark.tag ||
                    Consts.colors.tag,
            },
            light: {
                backgroundColor:
                    Consts.colors.light.tags.background[index] ||
                    Consts.colors.tags.background[index],
                color:
                    Consts.colors.light.tags.foreground[index] ||
                    Consts.colors.tags.foreground[index] ||
                    Consts.colors.light.tag ||
                    Consts.colors.tag,
            },
        })
    );

    TAG = vscode.window.createTextEditorDecorationType({
        color: Consts.colors.tag,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        dark: {
            color: Consts.colors.dark.tag || Consts.colors.tag,
        },
        light: {
            color: Consts.colors.light.tag || Consts.colors.tag,
        },
    });

    ID = vscode.window.createTextEditorDecorationType({
        color: Consts.colors.id,
        fontWeight: 'bold',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        dark: {
            color: Consts.colors.dark.id || Consts.colors.id,
        },
        light: {
            color: Consts.colors.light.id || Consts.colors.id,
        },
    });

    DEPENDENCY = vscode.window.createTextEditorDecorationType({
        color: Consts.colors.dependency,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        dark: {
            color: Consts.colors.dark.dependency || Consts.colors.dependency,
        },
        light: {
            color: Consts.colors.light.dependency || Consts.colors.dependency,
        },
    });

    DECORATIONS_SIGNATURE = signature;

    return { special: SPECIAL_TAGS, tag: TAG, id: ID, dependency: DEPENDENCY };
}

/* TAG */

class Tag extends Line {
    constructor() {
        super();

        const types = ensureDecorationTypes();

        this.TYPES = [...types.special, types.id, types.dependency, types.tag];
    }

    getItemRanges(tag: TagItem) {
        //FIXME: We are purposely not supporting tags inside code blocks, it's an uncommon case, we'll just be wasting some performance
        // this.TYPES.map ( ( type, index ) => tag.match[index + 1] && this.getRangeDifference ( tag.text, tag.range, [Consts.regexes.formattedCode] ) );
        const types = ensureDecorationTypes(),
            special = types.special.map((type, index) => tag.match[index + 1] && tag.range),
            id = tag.isId() && tag.range,
            dependency = tag.isDependency() && tag.range,
            normal = tag.isNormal() && !id && !dependency && tag.range;

        return [...special, id, dependency, normal];
    }
}

/* EXPORT */

export default Tag;
