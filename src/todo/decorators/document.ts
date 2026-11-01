/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Config from '../../config';
import Utils from '../../utils';
import DocumentModule from '../document';
import Comment from './comment';
import Formatted from './formatted';
import Project from './project';
import Tag from './tag';
import TodoDue from './todo_due';
import { disposeTaskTagDocument, getTaskTagDecorations, pruneTaskTagDocument } from './task-tags';
import { applyCustomColors } from './theme-colors';
import { hasMultilineSyntax, IncrementalDocument } from './incremental-document';

/* DOCUMENTS LINES CACHE */

const EditorDecorationTypes = new WeakMap<vscode.TextEditor, vscode.TextEditorDecorationType[]>();
const Snapshots = new WeakMap<
  vscode.TextEditor,
  { document: vscode.TextDocument; text: string; version: number; cache?: IncrementalDocument }
>();

/* DOCUMENT */

const Document = {
  /* UPDATE */

  update(
    res: vscode.TextEditor | vscode.TextDocument = vscode.window.activeTextEditor,
    force: boolean = false
  ) {
    const statisticsStatusbar = Config.getKey('statistics.statusbar.enabled') !== false,
      statisticsProjects = Config.getKey('statistics.project.enabled') !== false,
      activeEditor = vscode.window.activeTextEditor,
      StatusbarTimer = require('../../statusbars/timer').default;

    if (res) {
      const doc = new DocumentModule(res),
        editors = vscode.window.visibleTextEditors.filter(
          (editor) => editor.document === doc.textDocument
        );

      if (doc.isSupported()) {
        const text = doc.textDocument.getText();
        doc.text = text;
        const items = Document.getItems(doc),
          isActive = activeEditor && activeEditor.document === doc.textDocument,
          previousGlobalTokens = Utils.statistics.tokens.global;

        if (statisticsStatusbar || statisticsProjects) {
          Utils.statistics.tokens.updateGlobal(items);
        }

        if (statisticsProjects) {
          Utils.statistics.tokens.updateProjects(doc.textDocument, items);
        }

        const decorations = Document.getItemsDecorations(items, doc.textDocument);

        // Decoration types are shared by a document, but their ranges belong to
        // each editor. Replacing a type must refresh every visible split view.
        editors.forEach((editor) => {
          decorations.forEach(({ type, ranges }) => editor.setDecorations(type, ranges));
          EditorDecorationTypes.set(
            editor,
            decorations.map(({ type }) => type)
          );
          const cache =
            typeof doc.textDocument.version === 'number' &&
            doc.textDocument.languageId === 'todo' &&
            items.projects &&
            !hasMultilineSyntax(text) &&
            Utils.statistics.tokens.createGlobal
              ? new IncrementalDocument(
                  editor,
                  text,
                  items,
                  decorations,
                  (line) => Document.getItems(line),
                  (line) => Document.getItemsDecorations(line, doc.textDocument, false)
                )
              : undefined;
          Snapshots.set(editor, {
            document: doc.textDocument,
            text,
            version: doc.textDocument.version,
            cache,
          });
        });

        if (isActive) {
          StatusbarTimer.update(doc, items.todosStarted);
        }

        if (!isActive) {
          // Background editor decorations may need their own global conditions,
          // but the status bar continues to describe the active document.
          Utils.statistics.tokens.global = previousGlobalTokens;
        }
      } else {
        disposeTaskTagDocument(doc.textDocument);
        editors.forEach((editor) => {
          Snapshots.delete(editor);
          const types = EditorDecorationTypes.get(editor) || [];
          EditorDecorationTypes.delete(editor);
          types.forEach((type) => {
            try {
              editor.setDecorations(type, []);
            } catch {
              // A color refresh may already have disposed the shared type.
            }
          });
        });
      }
    }

    if (!Utils.editor.isSupported(activeEditor)) StatusbarTimer.update();

    const StatusbarStatistics = require('../../statusbars/statistics').default; // Avoiding a cyclic dependency

    // Update even when disabled so an already visible item is hidden immediately.
    StatusbarStatistics.update();
  },

  updateLines(
    res: vscode.TextEditor | vscode.TextDocument = vscode.window.activeTextEditor,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
  ) {
    if (!res) return;
    if (!('document' in res)) {
      // Each split editor owns its decoration sets, even for the same document.
      vscode.window.visibleTextEditors
        .filter((editor) => editor.document === res)
        .forEach((editor) => Document.updateLines(editor, changes));
      return;
    }
    const doc = new DocumentModule(res);

    if (!doc.isSupported()) return;

    const saved = Snapshots.get(doc.textEditor),
      snapshot = saved?.document === doc.textDocument ? saved : undefined;
    if (
      snapshot &&
      (typeof snapshot.version === 'number'
        ? snapshot.version === doc.textDocument.version
        : snapshot.text === doc.textDocument.getText())
    )
      return;

    if (snapshot?.cache?.matches(doc.textEditor)) {
      const previousGlobal = Utils.statistics.tokens.global,
        previousProjects = Utils.statistics.tokens.projects,
        result = snapshot.cache.update(changes),
        active = vscode.window.activeTextEditor?.document === doc.textDocument;
      if (result) {
        snapshot.version = doc.textDocument.version;
        EditorDecorationTypes.set(doc.textEditor, result.types);
        // A split that has not processed this edit may still use an old type.
        // Retire it only after every visible cache has released it.
        const retained = new Set<vscode.TextEditorDecorationType>();
        vscode.window.visibleTextEditors
          .filter((editor) => editor.document === doc.textDocument)
          .forEach((editor) =>
            (EditorDecorationTypes.get(editor) || []).forEach((type) => retained.add(type))
          );
        pruneTaskTagDocument(doc.textDocument, retained);
        if (active && result.timerChanged)
          require('../../statusbars/timer').default.update(doc, result.started());
        if (!active) {
          Utils.statistics.tokens.global = previousGlobal;
          Utils.statistics.tokens.projects = previousProjects;
        } else if (result.globalChanged) {
          require('../../statusbars/statistics').default.update();
        }
        return;
      }
    }

    Document.update(res, true);
  },

  /* ITEMS */

  getItems(doc: DocumentModule) {
    return {
      archive: doc.getArchive(),
      comments: doc.getComments(),
      formatted: Config.getKey('formatting.enabled') ? doc.getFormatted() : [],
      projects: doc.getProjects(),
      tags: doc.getTags(),
      tagsDue: doc.getTagsDue(),
      todosBox: doc.getTodosBox(),
      todosStarted: doc.getTodosBoxStarted(),
      todosDone: doc.getTodosDone(),
      todosCancelled: doc.getTodosCancelled(),
    };
  },

  getItemsDecorations(items, document?: vscode.TextDocument, pruneStyles: boolean = true) {
    const colorsEnabled = Config.getKey('colors.enabled') !== false;

    return _.concat(
      applyCustomColors(new Comment().getDecorations(items.comments), colorsEnabled),
      applyCustomColors(new Formatted().getDecorations(items.formatted), colorsEnabled),
      applyCustomColors(new Tag().getDecorations(items.tags), colorsEnabled),
      applyCustomColors(new TodoDue().getDecorations(items.tagsDue), colorsEnabled),
      new Project().getDecorations(items.projects),
      getTaskTagDecorations(
        [...items.todosBox, ...items.todosDone, ...items.todosCancelled],
        document,
        pruneStyles
      )
    );
  },
};

/* EXPORT */

export default Document;
