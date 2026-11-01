/* IMPORT */

import type { TextDocumentChangeEvent } from 'vscode';
import Document from './document';
import { isTaskDocument } from '../../utils/task-source';

/* CHANGES */

const Changes = {
  onChanges({ document, contentChanges }: TextDocumentChangeEvent) {
    if (!isTaskDocument(document)) return;

    if (!contentChanges.length) return; //URL: https://github.com/Microsoft/vscode/issues/50344

    Document.updateLines(document, contentChanges);
  },
};

/* EXPORT */

export default Changes;
