/* IMPORT */

import * as _ from 'lodash';
import * as path from 'path';
import * as vscode from 'vscode';
import Config from './config';
import Consts from './consts';
import Document from './todo/document';
import ItemFile from './views/items/item';
import ItemTodo from './views/items/todo';
import StatusbarTimer from './statusbars/timer';
import Utils from './utils';
import ViewEmbedded from './views/embedded';
import ViewFiles from './views/files';
import DependencyIndex from './utils/dependency_index';
import {
    DependencyReference,
    DependencyTarget,
    getDependencies,
    getIds,
    getUnresolvedIds,
    isValidId,
    normalizeId,
} from './utils/dependencies';

/* CALL TODOS METHOD */

const callTodosMethodOptions = {
    checkValidity: false,
    filter: _.identity,
    method: undefined,
    args: [],
    blockOnOpenDependencies: false,
    errors: {
        invalid: 'Only todos can perform this action',
        filtered: 'This todo cannot perform this action',
    },
};

async function callTodosMethod(options?) {
    options = _.isString(options) ? { method: options } : options;
    options = _.merge({}, callTodosMethodOptions, options);

    const textEditor = vscode.window.activeTextEditor,
        doc = new Document(textEditor);

    if (!doc.isSupported()) return;

    const lines = _.uniq(
            _.flatten(
                textEditor.selections.map((selection) =>
                    _.range(selection.start.line, selection.end.line + 1)
                )
            )
        ),
        todos = _.filter(lines.map((line) => doc.getTodoAt(line, options.checkValidity)));

    if (todos.length !== lines.length) vscode.window.showErrorMessage(options.errors.invalid);

    if (!todos.length) return;

    let todosFiltered = todos.filter(options.filter);

    if (todosFiltered.length !== todos.length)
        vscode.window.showErrorMessage(options.errors.filtered);

    if (!todosFiltered.length) return;

    if (options.blockOnOpenDependencies) {
        const blocked = await getBlockedTodos(todosFiltered, textEditor.document);

        if (blocked.length) {
            const ids = _.uniq(_.flatten(blocked.map(({ ids }) => ids)));

            todosFiltered = todosFiltered.filter(
                (todo) => !blocked.some((blockedTodo) => blockedTodo.todo === todo)
            );
            vscode.window.showErrorMessage(
                `Cannot finish task: unresolved dependencies (${ids.join(', ')})`
            );
        }
    }

    if (!todosFiltered.length) return;

    todosFiltered.map((todo) => todo[options.method](...options.args));

    const edits = _.filter(_.flattenDeep(todosFiltered.map((todo) => todo['makeEdit']())));

    if (!edits.length) return;

    const selectionsTagIndexes = textEditor.selections.map((selection) => {
        const line = textEditor.document.lineAt(selection.start.line);
        return line.text.indexOf(Consts.symbols.tag);
    });

    await Utils.editor.edits.apply(textEditor, edits);

    textEditor.selections = textEditor.selections.map((selection, index) => {
        // Putting the cursors before first new tag
        if (selectionsTagIndexes[index] >= 0) return selection;
        const line = textEditor.document.lineAt(selection.start.line);
        if (selection.start.character !== line.text.length) return selection;
        const tagIndex = line.text.indexOf(Consts.symbols.tag);
        if (tagIndex < 0) return selection;
        const position = new vscode.Position(selection.start.line, tagIndex);
        return new vscode.Selection(position, position);
    });
}

/* COMMANDS */

async function open(filePath?: string, lineNumber?: number) {
    filePath = _.isString(filePath) ? filePath : undefined;
    lineNumber = _.isNumber(lineNumber) ? lineNumber : undefined;

    if (filePath) {
        return Utils.file.open(filePath, true, lineNumber);
    } else {
        const config = Config.get(),
            { activeTextEditor } = vscode.window,
            editorPath = activeTextEditor && activeTextEditor.document.uri.fsPath,
            rootPath = Utils.folder.getRootPath(editorPath);

        if (!rootPath)
            return vscode.window.showErrorMessage(
                'You have to open a project before being able to open its todo file'
            );

        const projectPath = ((await Utils.folder.getWrapperPathOf(
                rootPath,
                editorPath || rootPath,
                config.file.name
            )) || rootPath) as string,
            todo = Utils.todo.get(projectPath);

        if (!_.isUndefined(todo)) {
            // Open

            return Utils.file.open(todo.path, true, lineNumber);
        } else {
            // Create

            const defaultPath = path.join(projectPath, config.file.name);

            await Utils.file.make(defaultPath, config.file.defaultContent);

            return Utils.file.open(defaultPath);
        }
    }
}

async function openEmbedded() {
    await Utils.embedded.initProvider();

    const config = Config.get(),
        todos = await Utils.embedded.provider.get(
            undefined,
            config.embedded.file.groupByRoot,
            config.embedded.file.groupByType,
            config.embedded.file.groupByFile
        ),
        content = Utils.embedded.provider.renderTodos(todos);

    if (!content) return vscode.window.showInformationMessage('No embedded todos found');

    Utils.editor.open(content);
}

function toggleBox() {
    return callTodosMethod('toggleBox');
}

function toggleDone() {
    return callTodosMethod({ method: 'toggleDone', blockOnOpenDependencies: true });
}

function toggleCancelled() {
    return callTodosMethod({ method: 'toggleCancelled', blockOnOpenDependencies: true });
}

function toggleStart() {
    return callTodosMethod({
        checkValidity: true,
        filter: (todo) => todo.isBox(),
        method: 'toggleStart',
        errors: {
            invalid: 'Only todos can be started',
            filtered: 'Only not done/cancelled todos can be started',
        },
    });
}

function toggleTimer() {
    Consts.timer = !Consts.timer;

    StatusbarTimer.updateVisibility();
    StatusbarTimer.updateTimer();

    vscode.window.showInformationMessage(`Timer ${Consts.timer ? 'enabled' : 'disabled'}`);
}

function archive() {
    const textEditor = vscode.window.activeTextEditor,
        doc = new Document(textEditor);

    Utils.log.debug(`archive command invoked. activeEditor=${!!textEditor}`);
    if (!doc.isSupported()) {
        Utils.log.debug('archive aborted: not a supported todo document');
        // Helpful message for users when command does not run
        return vscode.window.showInformationMessage('This command works only in Todo files');
    }

    Utils.log.debug(`archive on document: ${textEditor.document.fileName}`);
    Utils.archive.run(doc);
}

/* VIEW */

function viewOpenFile(file: ItemFile) {
    Utils.file.open(file.resourceUri.fsPath, true, 0);
}

function viewRevealTodo(todo: ItemTodo) {
    if (todo.obj.todo) {
        const startIndex = todo.obj.rawLine.indexOf(todo.obj.todo),
            endIndex = startIndex + todo.obj.todo.length;

        Utils.file.open(todo.obj.filePath, true, todo.obj.lineNr, startIndex, endIndex);
    } else {
        Utils.file.open(todo.obj.filePath, true, todo.obj.lineNr);
    }
}

function openDependencyTarget(target: DependencyTarget) {
    if (!target || !target.filePath) return;

    return Utils.file.open(target.filePath, true, target.lineNumber, target.start, target.end);
}

async function openDependency(targets: DependencyTarget[]) {
    if (!targets || !targets.length) return;

    if (targets.length === 1) return openDependencyTarget(targets[0]);

    const items = targets.map((target) => {
        const parsedPath = Utils.folder.parsePath(target.filePath),
            relativePath = parsedPath.relativePath || target.filePath;

        return {
            label: _.trimStart(target.text),
            description: `${relativePath}:${target.lineNumber + 1}`,
            target,
        };
    });
    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: 'Multiple tasks use this ID. Choose one to open.',
    });

    if (selection) return openDependencyTarget(selection.target);
}

function openDependencyAtCursor() {
    return vscode.commands.executeCommand('editor.action.openLink');
}

async function addDependency() {
    const textEditor = vscode.window.activeTextEditor,
        doc = new Document(textEditor);

    if (!doc.isSupported()) return;

    const todo: any = doc.getTodoAt(textEditor.selection.active.line);

    if (!todo) {
        return vscode.window.showErrorMessage(
            'Place the cursor on a todo before adding a dependency'
        );
    }

    const index = await DependencyIndex.get(textEditor.document);
    const ids = Object.keys(index.targets).sort();

    if (!ids.length)
        return vscode.window.showInformationMessage('No task IDs found in the workspace');

    const selection = await vscode.window.showQuickPick(
        ids.map((id) => ({
            label: id,
            description: `${index.targets[id].length} matching task${
                index.targets[id].length === 1 ? '' : 's'
            }`,
        })),
        { placeHolder: 'Choose a task ID to add as a dependency' }
    );

    if (!selection) return;

    if (getDependencies(todo.text).some((dependency) => dependency.id === selection.label)) {
        return vscode.window.showInformationMessage(
            `This task already depends on ${selection.label}`
        );
    }

    todo.addTag(`@depends(${selection.label})`);

    await Utils.editor.edits.apply(textEditor, todo.makeEdit());
}

async function findDependents() {
    const id = await getIdAtCursorOrPrompt('Find tasks that depend on this ID');

    if (!id) return;

    const textEditor = vscode.window.activeTextEditor;
    const index = await DependencyIndex.get(textEditor && textEditor.document);
    const dependents = index.dependencies[id] || [];

    if (!dependents.length) return vscode.window.showInformationMessage(`No tasks depend on ${id}`);

    const selection = await vscode.window.showQuickPick(makeDependencyItems(dependents), {
        placeHolder: `${dependents.length} task${dependents.length === 1 ? '' : 's'} depend on ${id}`,
    });

    if (selection) return openDependencyTarget(selection.target);
}

async function renameDependencyId() {
    const id = await getIdAtCursorOrPrompt('Task ID to rename');

    if (!id) return;

    const nextIdRaw = await vscode.window.showInputBox({
        prompt: 'Rename the ID and all of its references',
        value: id,
    });

    if (_.isUndefined(nextIdRaw)) return;

    const nextId = normalizeId(nextIdRaw);

    if (!isValidId(nextId)) {
        return vscode.window.showErrorMessage(
            'An ID cannot be empty or contain a closing parenthesis'
        );
    }

    if (nextId === id) return;

    const textEditor = vscode.window.activeTextEditor;
    const index = await DependencyIndex.get(textEditor && textEditor.document);
    const locations = (index.targets[id] || []).concat(index.dependencies[id] || []);

    if (!locations.length)
        return vscode.window.showInformationMessage(`No occurrences of ${id} found`);

    const edit = new vscode.WorkspaceEdit();

    locations.forEach((location) => {
        edit.replace(
            vscode.Uri.file(location.filePath),
            new vscode.Range(
                location.lineNumber,
                location.start,
                location.lineNumber,
                location.end
            ),
            nextId
        );
    });

    if (await vscode.workspace.applyEdit(edit)) {
        return vscode.window.showInformationMessage(
            `Renamed ${id} to ${nextId} in ${locations.length} place${
                locations.length === 1 ? '' : 's'
            }`
        );
    }
}

async function getBlockedTodos(todos: any[], document: vscode.TextDocument) {
    const index = await DependencyIndex.get(document);

    return todos
        .filter((todo) => !todo.isFinished())
        .map((todo) => {
            const ids = getUnresolvedIds(
                getDependencies(todo.text),
                index.targets,
                DependencyIndex.isFinished
            );

            return { todo, ids };
        })
        .filter(({ ids }) => ids.length);
}

async function getIdAtCursorOrPrompt(prompt: string) {
    const textEditor = vscode.window.activeTextEditor;

    if (Utils.editor.isSupported(textEditor)) {
        const line = textEditor.document.lineAt(textEditor.selection.active.line).text;
        const references: DependencyReference[] = getIds(line).concat(getDependencies(line));
        const reference = references.find(
            ({ tagStart, tagEnd }) =>
                textEditor.selection.active.character >= tagStart &&
                textEditor.selection.active.character <= tagEnd
        );

        if (reference) return reference.id;
    }

    const input = await vscode.window.showInputBox({ prompt });

    return input && normalizeId(input);
}

function makeDependencyItems(targets: DependencyTarget[]) {
    return targets.map((target) => {
        const parsedPath = Utils.folder.parsePath(target.filePath),
            relativePath = parsedPath.relativePath || target.filePath;

        return {
            label: _.trimStart(target.text),
            description: `${relativePath}:${target.lineNumber + 1}`,
            target,
        };
    });
}

/* VIEW FILE */

function viewFilesOpen() {
    open();
}

function viewFilesCollapse() {
    ViewFiles.expanded = false;
    vscode.commands.executeCommand('setContext', 'todo-files-expanded', false);
    ViewFiles.refresh(true);
}

function viewFilesExpand() {
    ViewFiles.expanded = true;
    vscode.commands.executeCommand('setContext', 'todo-files-expanded', true);
    ViewFiles.refresh(true);
}

/* VIEW EMBEDDED */

function viewEmbeddedCollapse() {
    ViewEmbedded.expanded = false;
    vscode.commands.executeCommand('setContext', 'todo-embedded-expanded', false);
    ViewEmbedded.refresh(true);
}

function viewEmbeddedExpand() {
    ViewEmbedded.expanded = true;
    vscode.commands.executeCommand('setContext', 'todo-embedded-expanded', true);
    ViewEmbedded.refresh(true);
}

async function viewEmbeddedFilter() {
    const filter = await vscode.window.showInputBox({ placeHolder: 'Filter string...' });

    if (!filter || ViewEmbedded.filter === filter) return;

    ViewEmbedded.filter = filter;
    vscode.commands.executeCommand('setContext', 'todo-embedded-filtered', true);
    ViewEmbedded.refresh();
}

const embeddedFilter = viewEmbeddedFilter;

function viewEmbeddedClearFilter() {
    ViewEmbedded.filter = false;
    vscode.commands.executeCommand('setContext', 'todo-embedded-filtered', false);
    ViewEmbedded.refresh();
}

const embeddedClearFilter = viewEmbeddedClearFilter;

function viewEmbeddedToggleAllFiles(force: boolean = !ViewEmbedded.all) {
    ViewEmbedded.all = force;
    vscode.commands.executeCommand('setContext', 'todo-embedded-all', force);
    ViewEmbedded.refresh();
}

function viewEmbeddedShowAllFiles() {
    viewEmbeddedToggleAllFiles(true);
}

function viewEmbeddedShowActiveFile() {
    viewEmbeddedToggleAllFiles(false);
}

/* EXPORT */

export {
    open,
    openEmbedded,
    toggleBox,
    toggleDone,
    toggleCancelled,
    toggleStart,
    toggleTimer,
    archive,
    viewOpenFile,
    viewRevealTodo,
    openDependency,
    openDependencyAtCursor,
    addDependency,
    findDependents,
    renameDependencyId,
    viewFilesOpen,
    viewFilesCollapse,
    viewFilesExpand,
    viewEmbeddedCollapse,
    viewEmbeddedExpand,
    viewEmbeddedFilter,
    embeddedFilter,
    viewEmbeddedClearFilter,
    embeddedClearFilter,
    viewEmbeddedToggleAllFiles,
    viewEmbeddedShowAllFiles,
    viewEmbeddedShowActiveFile,
};
export {
    toggleBox as editorToggleBox,
    toggleDone as editorToggleDone,
    toggleCancelled as editorToggleCancelled,
    toggleStart as editorToggleStart,
    archive as editorArchive,
};
