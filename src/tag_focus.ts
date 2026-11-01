import { commands, languages, Position, Selection, window, workspace } from 'vscode';
import type { Disposable, ExtensionContext, TextDocument, TextEditor } from 'vscode';
import Consts from './consts';
import { FoldingProvider } from './providers/folding';
import { getEditorSetting } from './utils/editor-configuration';
import { getCodeBlocks } from './utils/code-blocks';
import { getFocusTagNames, isTagFocusHeader, TAG_FOCUS_HEADER } from './utils/tag-focus';

const getLines = (document: TextDocument): string[] =>
  Array.from({ length: document.lineCount }, (_, line) => document.lineAt(line).text);

export class TagFocus implements Disposable {
  private tags = new Map<TextDocument, string>();
  private provider = new FoldingProvider((document) => this.tags.get(document));
  private registration: Disposable;
  private subscriptions: Disposable[] = [];
  private timer: ReturnType<typeof setTimeout>;
  private revision = 0;
  private disposed = false;

  initialize(context: ExtensionContext): void {
    this.disposed = false;
    this.refreshProvider();
    this.updateContext();
    this.subscriptions.push(
      workspace.onDidCloseTextDocument((document) => {
        // Language changes close/reopen a document without switching editors
        // or changing its text version. Invalidate pending picker results too.
        const wasFocused = this.tags.delete(document);
        if (window.activeTextEditor?.document === document) this.cancelPending();
        if (wasFocused) {
          this.refreshProvider();
          this.updateContext();
        }
      }),
      workspace.onDidChangeTextDocument(({ document }) => {
        if (this.tags.has(document) && window.activeTextEditor?.document === document) {
          this.schedule();
        }
      }),
      window.onDidChangeActiveTextEditor(() => {
        this.cancelPending();
        this.updateContext();
        this.schedule();
      }),
      window.onDidChangeTextEditorOptions(({ textEditor }) => {
        if (textEditor.document.languageId !== Consts.languageId) return;

        if (textEditor === window.activeTextEditor && this.tags.has(textEditor.document)) {
          this.schedule();
        } else {
          this.refreshProvider();
        }
      }),
      workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('editor.folding') ||
          event.affectsConfiguration('editor.foldingStrategy') ||
          event.affectsConfiguration('editor.tabSize') ||
          event.affectsConfiguration(`[${Consts.languageId}]`) ||
          event.affectsConfiguration('todo.symbols')
        )
          this.schedule();
      })
    );
    context.subscriptions.push(this);
  }

  async focus(tag?: string): Promise<void> {
    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== Consts.languageId) {
      window.showInformationMessage('This command works only in Todo files');
      return;
    }
    if (!this.canFold(editor)) {
      window.showInformationMessage(
        'Tag focus requires editor folding with the auto folding strategy.'
      );
      return;
    }

    const document = editor.document;
    const version = document.version;
    const requestRevision = this.revision;
    const choices = this.getTags(document);
    if (!choices.length) {
      window.showInformationMessage('No task tags found in this Todo file.');
      return;
    }

    const chosen = tag
      ? choices.find((name) => name.toLowerCase() === `@${tag.replace(/^@/, '')}`.toLowerCase())
      : await window.showQuickPick(choices, { placeHolder: 'Focus on a task tag…' });
    if (!chosen) return;
    if (!this.isCurrent(editor, requestRevision) || document.version !== version) {
      window.showInformationMessage(
        'The Todo file or active editor changed. Please run the command again.'
      );
      return;
    }
    if (!this.canFold(editor)) {
      window.showInformationMessage(
        'Tag focus requires editor folding with the auto folding strategy.'
      );
      return;
    }

    // Keep the previous focus refreshing while the picker is open. Only an
    // accepted choice should replace its pending work.
    const revision = this.cancelPending();

    if (!isTagFocusHeader(document.lineAt(0).text)) {
      const applied = await editor.edit((edit) =>
        edit.insert(new Position(0, 0), `${TAG_FOCUS_HEADER}\n`)
      );
      if (!applied || !this.isCurrent(editor, revision)) return;
    }
    if (!isTagFocusHeader(document.lineAt(0).text)) return;

    this.tags.set(document, chosen);
    this.updateContext();
    await this.apply(editor, revision);
  }

  async clear(): Promise<void> {
    const editor = window.activeTextEditor;
    this.cancelPending();
    if (!editor || !this.tags.delete(editor.document)) return;

    this.refreshProvider();
    this.updateContext();
    await commands.executeCommand('editor.unfoldAll');
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending();
    this.tags.clear();
    this.registration?.dispose();
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.subscriptions = [];
  }

  private getTags(document: TextDocument): string[] {
    const todo = new RegExp(Consts.regexes.todo.source, Consts.regexes.todo.flags.replace('g', ''));
    const code = getCodeBlocks(document);
    const lines = getLines(document).map((line, index) => (code.byLine.has(index) ? '' : line));
    return getFocusTagNames(lines, (line) => todo.test(line), Consts.regexes.tag);
  }

  private canFold(editor: TextEditor): boolean {
    return (
      getEditorSetting<boolean>(editor.document, 'folding') !== false &&
      getEditorSetting<string>(editor.document, 'foldingStrategy') !== 'indentation'
    );
  }

  private refreshProvider(): void {
    this.registration?.dispose();
    // Re-registering invalidates ranges even on VS Code 1.36, whose provider API
    // predates onDidChangeFoldingRanges.
    this.registration = languages.registerFoldingRangeProvider(Consts.languageId, this.provider);
  }

  private updateContext(): void {
    const editor = window.activeTextEditor;
    commands.executeCommand(
      'setContext',
      'todo-tag-focused',
      !!editor && this.tags.has(editor.document)
    );
  }

  private cancelPending(): number {
    clearTimeout(this.timer);
    return ++this.revision;
  }

  private isCurrent(editor: TextEditor, revision: number): boolean {
    return (
      !this.disposed &&
      this.revision === revision &&
      !editor.document.isClosed &&
      editor.document.languageId === Consts.languageId &&
      window.activeTextEditor === editor
    );
  }

  private schedule(): void {
    const editor = window.activeTextEditor;
    if (!editor || !this.tags.has(editor.document)) return;

    const revision = this.cancelPending();
    this.timer = setTimeout(() => {
      this.apply(editor, revision).catch((error) =>
        console.warn('Todo+: Could not refresh tag focus', error)
      );
    }, 250);
  }

  private async apply(editor: TextEditor, revision: number): Promise<void> {
    if (!this.isCurrent(editor, revision)) return;
    if (!isTagFocusHeader(editor.document.lineAt(0).text) || !this.canFold(editor)) {
      await this.clear();
      return;
    }

    const version = editor.document.version;
    this.refreshProvider();
    await commands.executeCommand('editor.unfoldAll');
    if (!this.isCurrent(editor, revision) || editor.document.version !== version) return;

    const ranges = this.provider.provideFoldingRanges(editor.document);
    if (!ranges.length) return;
    editor.selections = editor.selections.map((selection) => {
      const hidden = ranges.find(
        (range) => range.start < selection.active.line && selection.active.line <= range.end
      );
      return hidden ? new Selection(hidden.start, 0, hidden.start, 0) : selection;
    });
    await commands.executeCommand('editor.fold', {
      levels: 1,
      direction: 'down',
      selectionLines: ranges.map((range) => range.start),
    });
  }
}

export const tagFocus = new TagFocus();
