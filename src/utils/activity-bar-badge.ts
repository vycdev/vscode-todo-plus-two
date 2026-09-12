import { matchesTodoStatus } from './todo-status';

interface TextLineLike {
    text: string;
}

interface TextDocumentLike {
    lineCount: number;
    lineAt(lineNumber: number): TextLineLike;
}

interface TodoFileData {
    textEditor?: TextDocumentLike;
}

interface ViewBadgeLike {
    value: number;
    tooltip: string;
}

export const countPendingTodos = (filesData, pendingPattern: RegExp): number => {
    if (!filesData) return 0;

    return Object.keys(filesData).reduce((count, filePath) => {
        const data = filesData[filePath] as TodoFileData;

        if (!data || !data.textEditor) return count;

        for (let lineNumber = 0; lineNumber < data.textEditor.lineCount; lineNumber++) {
            if (matchesTodoStatus(data.textEditor.lineAt(lineNumber).text, pendingPattern)) count++;
        }

        return count;
    }, 0);
};

export const getActivityBarBadge = (pending: number): ViewBadgeLike | undefined => {
    if (pending < 1) return undefined;

    return {
        value: pending,
        tooltip: `${pending} pending todo${pending === 1 ? '' : 's'}`,
    };
};

export const supportsActivityBarBadge = (treeView: any): boolean =>
    !!treeView && 'badge' in treeView;

export const updateActivityBarBadge = (treeView: any, pending: number): boolean => {
    // TreeView badges were added after the extension's minimum VS Code version.
    if (!supportsActivityBarBadge(treeView)) return false;

    treeView.badge = getActivityBarBadge(pending);

    return true;
};
