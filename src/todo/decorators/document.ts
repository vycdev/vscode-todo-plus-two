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
import TodoDone from './todo_done';
import TodoCancelled from './todo_cancelled';
import TodoStarted from './todo_started';
import { DocumentLinesCache } from './document-lines-cache';
import { applyCustomColors } from './theme-colors';

/* DOCUMENTS LINES CACHE */

const DocumentsLinesCache = new DocumentLinesCache();

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
      const doc = new DocumentModule(res);

      if (doc.isSupported()) {
        // if ( !force && !DocumentsLinesCache.didChange ( doc ) ) return; //FIXME: Decorations might get trashed, so we can't skip this work //URL: https://github.com/Microsoft/vscode/issues/50415

        DocumentsLinesCache.update(doc.textDocument);

        const items = Document.getItems(doc),
          isActive = activeEditor && activeEditor.document === doc.textDocument,
          previousGlobalTokens = Utils.statistics.tokens.global;

        if (statisticsStatusbar || statisticsProjects) {
          Utils.statistics.tokens.updateGlobal(items);
        }

        if (statisticsProjects) {
          Utils.statistics.tokens.updateProjects(doc.textDocument, items);
        }

        const decorations = Document.getItemsDecorations(items);

        decorations.forEach(({ type, ranges }) => {
          doc.textEditor.setDecorations(type, ranges);
        });

        if (isActive) {
          StatusbarTimer.update(doc);
        } else {
          // Background editor decorations may need their own global conditions,
          // but the status bar continues to describe the active document.
          Utils.statistics.tokens.global = previousGlobalTokens;
        }
      }
    }

    if (!Utils.editor.isSupported(activeEditor)) StatusbarTimer.update();

    const StatusbarStatistics = require('../../statusbars/statistics').default; // Avoiding a cyclic dependency

    // Update even when disabled so an already visible item is hidden immediately.
    StatusbarStatistics.update();
  },

  updateLines(
    res: vscode.TextEditor | vscode.TextDocument = vscode.window.activeTextEditor,
    lineNrs: number[]
  ) {
    const doc = new DocumentModule(res);

    if (!doc.isSupported()) return;

    // Equal match ranges do not imply equal behavior: editing a tag value can
    // change statistics, the timer or due colors without changing its length.
    if (!DocumentsLinesCache.didChange({ textDocument: doc.textDocument })) return;

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

  getItemsDecorations(items) {
    const colorsEnabled = Config.getKey('colors.enabled') !== false;

    return _.concat(
      applyCustomColors(new Comment().getDecorations(items.comments), colorsEnabled),
      applyCustomColors(new Formatted().getDecorations(items.formatted), colorsEnabled),
      applyCustomColors(new Tag().getDecorations(items.tags), colorsEnabled),
      applyCustomColors(new TodoDue().getDecorations(items.tagsDue), colorsEnabled),
      new Project().getDecorations(items.projects),
      applyCustomColors(new TodoStarted().getDecorations(items.todosStarted), colorsEnabled),
      new TodoDone().getDecorations(items.todosDone),
      applyCustomColors(new TodoCancelled().getDecorations(items.todosCancelled), colorsEnabled)
    );
  },
};

/* EXPORT */

export default Document;
