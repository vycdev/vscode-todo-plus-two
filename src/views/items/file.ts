/* IMPORT */

import * as vscode from 'vscode';
import Group from './group';
import { getFileOpenCommand } from './file-command';

/* FILE */

class File extends Group {
    contextValue = 'file';
    iconPath = vscode.ThemeIcon.File;

    constructor(obj, uri) {
        super(obj, uri.label);

        this.resourceUri = uri;
        this.command = getFileOpenCommand(this);
    }
}

/* EXPORT */

export default File;
