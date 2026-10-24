/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import * as moment from 'moment';
import { Comment, Project, Todo, TodoBox } from '../todo/items';
import Document from '../todo/document';
import Config from '../config';
import Consts from '../consts';
import AST from './ast';
import Utils from './index';
import Editor from './editor';
import * as path from 'path';
import Folder from './folder';
import { archiveToFile } from './archive-storage';
import {
  createArchiveFinishedDateGetter,
  getRemovableEmptyLineNumbers,
  getTrailingEmptySeparatorStart,
} from './archive-helpers';

/* ARCHIVE */

const Archive = {
  async get(doc: Document, insert: boolean = false) {
    let archive = doc.getArchive();

    if (archive) return archive;

    if (insert) {
      const config = Config.get(),
        pos = doc.textDocument.positionAt(Infinity), // Last pos
        text = `\n${config.archive.name}${Consts.symbols.project}\n`,
        edit = Editor.edits.makeInsert(text, pos.line, pos.character);

      if (!(await Editor.edits.apply(doc.textEditor, [edit]))) {
        throw new Error('Unable to create the Archive section');
      }

      return doc.getArchive();
    }
  },

  async run(doc: Document) {
    Utils.log.debug(`Archive.run invoked for ${doc.textDocument.fileName}`);
    const archive = await Archive.get(doc),
      archivableRange = new vscode.Range(
        0,
        0,
        archive ? archive.line.range.start.line : Infinity,
        archive ? archive.line.range.start.character : Infinity
      ),
      archivableText = doc.textDocument.getText(archivableRange),
      archivableDoc = new Document(doc.textDocument);

    archivableDoc.text = archivableText;

    const data = {
      remove: [], // Lines to remove
      // Map of `lineNumber => { text, projects?: string[] }` to insert
      insert: {},
      archiveLine: archive ? archive.line.range.start.line : undefined,
    };

    for (let transformation of Archive.transformations.order) {
      Archive.transformations[transformation](archivableDoc, data);
    }

    Utils.log.debug(
      `Archive.run: computed data: remove=${data.remove.length}, insert=${Object.keys(data.insert).length}`
    );

    await Archive.edit(doc, data);
  },

  async edit(doc: Document, data) {
    //FIXME: Refactor, this is getting quite ugly

    const finishedFormat = Config.getKey('timekeeping.finished.format');

    const getFinishedDate = createArchiveFinishedDateGetter(
      Consts.regexes.todoFinished,
      Consts.regexes.tagFinished,
      (value) => moment(value, finishedFormat).toDate()
    );

    const line2number = (line) => line.lineNumber;
    const line2date = Config.getKey('archive.sortByDate')
      ? (line) => getFinishedDate(line.obj ? line.obj.text : line.text)
      : _.constant(-1);
    const natSort = (a, b) => a.lineNumber - b.lineNumber;
    const removeLines = _.uniqBy(data.remove, line2number) as any; //TSC
    const insertItems = _.orderBy(
      _.map(data.insert, (obj, lineNumber) => ({ obj, lineNumber: Number(lineNumber) })).sort(
        natSort
      ),
      [line2date],
      ['desc']
    ); //TSC
    // Fallback: if any insert item somehow missed project metadata, compute it again.
    if (doc.textDocument) {
      insertItems.forEach((item) => {
        if (item.obj && item.obj.projects && item.obj.projects.length) return;

        const projects = [] as string[];
        AST.walkUp(doc.textDocument, item.lineNumber, true, true, ({ line }) => {
          if (!Project.is(line.text)) return;
          const parts = line.text.match(Consts.regexes.projectParts);
          if (parts) projects.push(parts[2]);
        });

        if (projects.length) {
          item.obj = item.obj || {};
          item.obj.projects = projects.reverse();
        }
      });
    }
    const insertLines = insertItems.map((line) => line.obj.text);
    const edits = [];
    let editsApplied = false;

    Utils.log.debug(
      `Archive.edit: removeLines=${removeLines.length} insertLines=${insertLines.length}`
    );
    removeLines.forEach((line) => {
      edits.push(Editor.edits.makeDeleteLine(line.lineNumber));
    });

    if (insertLines.length) {
      Utils.log.debug(`Archive.edit: processing ${insertLines.length} insert items`);
      const config = Config.get();
      // Create helperConfig and set indentation based on the document/editor.
      const helperConfig = Object.assign({}, config);
      helperConfig.lineEnding = doc.textDocument.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      try {
        // Prefer the editor's indentation settings (tabSize/insertSpaces) when available
        if (doc.textEditor && doc.textEditor.options) {
          const editorOptions = doc.textEditor.options as any;
          const insertSpaces = editorOptions.insertSpaces !== false;
          let tabSize = editorOptions.tabSize;
          if (tabSize === 'auto' || !_.isNumber(tabSize)) tabSize = 4; // sensible default
          helperConfig.indentation = insertSpaces ? ' '.repeat(tabSize) : '\t';
        } else {
          const detectedIndent = AST.getIndentation(doc.textDocument);
          helperConfig.indentation = detectedIndent || helperConfig.indentation;
        }
      } catch (e) {
        helperConfig.indentation = helperConfig.indentation || (Consts as any).indentation;
      }

      const archiveType = (Config.getKey('archive.type') as string) || 'InMultiSeparateFile';

      if (archiveType === 'InMultiSeparateFile') {
        // Per-original-file archives
        const originalPath = doc.textDocument.uri.fsPath;
        let basename = path.basename(originalPath);

        // Avoid archive filename like ARCHIVE..todo when source filename is ".todo"
        if (basename.startsWith('.')) basename = basename.slice(1);
        const dir = path.dirname(originalPath);
        const archiveName = `ARCHIVE.${basename}`;
        const archivePath = path.join(dir, archiveName);

        await archiveToFile(archivePath, doc.textDocument, edits, (content) =>
          Archive.mergeInsertItemsIntoArchiveContent(content, insertItems, helperConfig, Todo.is)
        );
        editsApplied = true;
      } else if (archiveType === 'InSeparateFile') {
        // Put all archives in a single file at workspace root
        const originalPath = doc.textDocument.uri.fsPath;
        const rootPath = Folder.getRootPath(originalPath) || path.dirname(originalPath);
        let archiveFileBase = config.file.name;

        if (_.isString(archiveFileBase) && archiveFileBase.startsWith('.')) {
          archiveFileBase = archiveFileBase.slice(1);
        }

        const archiveFileName = `ARCHIVE.${archiveFileBase}`;
        const archivePath = path.join(rootPath, archiveFileName);

        await archiveToFile(archivePath, doc.textDocument, edits, (content) =>
          Archive.mergeInsertItemsIntoArchiveContent(content, insertItems, helperConfig, Todo.is)
        );
        editsApplied = true;
      } else {
        // default behaviour: insert to the same file under the Archive project
        const archive = await Archive.get(doc, true);

        // Compute proper indentation for same-file archive while preserving relative indentation
        const archiveLevel = AST.getLevel(doc.textDocument, archive.line.text);
        // Tell the helper how many indentation levels should exist at the Archive root.
        helperConfig.rootIndentLevel = archiveLevel + 1;

        // Merge into the existing Archive section so we don't duplicate project headers
        const startLine = archive.line.range.start.line + 1;
        const lastLine = doc.textDocument.lineCount - 1;
        const mergedContent = Archive.mergeInsertItemsIntoArchiveContent(
          doc.textDocument.getText(
            new vscode.Range(startLine, 0, lastLine, doc.textDocument.lineAt(lastLine).text.length)
          ),
          insertItems,
          helperConfig,
          Todo.is
        );

        if (startLine <= lastLine) {
          const range = new vscode.Range(
            startLine,
            0,
            lastLine,
            doc.textDocument.lineAt(lastLine).text.length
          );
          edits.push(vscode.TextEdit.replace(range, mergedContent));
          Utils.log.debug(
            `Archive.edit: replacing range ${range.start.line}-${range.end.line} with merged content size=${mergedContent.length}`
          );
        } else {
          // No existing archive content, insert
          edits.push(Editor.edits.makeInsert(mergedContent, startLine, 0));
          Utils.log.debug(
            `Archive.edit: inserting merged content at ${startLine} size=${mergedContent.length}`
          );
        }
      }
    }

    // Apply edits to the document and wait for them to complete
    if (!edits.length) {
      Utils.log.debug('Archive.edit: no edits to apply');
    } else if (!editsApplied) {
      Utils.log.debug(`Archive.edit: applying ${edits.length} edits`);
      if (!(await Editor.edits.apply(doc.textEditor, edits))) {
        throw new Error('Unable to apply the archive edits');
      }
      Utils.log.debug('Archive.edit: edits applied');
    }

    // Refresh decorations & statusbars for the updated document
    const DocumentDecorator = require('../todo/decorators/document').default; // Avoiding cyclic dependency
    DocumentDecorator.update(doc.textEditor || doc.textDocument, true);
  },

  /* HELPERS */
  // Merge insert items into an archive file's content, attempting to place
  // todos/comments under existing project headers when possible.
  mergeInsertItemsIntoArchiveContent: require('./archive-helpers').default,

  transformations: {
    // Transformations to apply to the document

    order: [
      'addTodosFinished',
      'addTodosComments',
      'addProjectHeaders',
      // 'addProjectTag' removed: we avoid adding @project tags
      'removeEmptyProjects',
      'removeEmptyLines',
    ], // The order in which to apply the transformations

    addTodosFinished(doc: Document, data) {
      const todosFinished = doc.getTodosFinished(),
        lines = todosFinished.map((todo) => todo.line);

      lines.forEach((line) => {
        data.remove.push(line);
        // Preserve original line text (including indentation)
        data.insert[line.lineNumber] = {
          text: Utils.tags.remove(line.text, Config.getKey('archive.remove.tags')),
        };
      });
    },

    addTodosComments(doc: Document, data) {
      data.remove.forEach((thisLine) => {
        AST.walkDown(
          doc.textDocument,
          thisLine.lineNumber,
          true,
          false,
          function ({ startLevel, line, level }) {
            // Include contiguous comments after the todo, at same or deeper indentation
            if (Comment.is(line.text) && level >= startLevel) {
              data.remove.push(line);
              // Keep a task and its comments in one block so sorting
              // and indentation normalization cannot separate them.
              data.insert[thisLine.lineNumber].text += `\n${line.text}`;
              return true; // Continue walking
            }

            // Stop if we reach any non-comment line (another todo, project, etc.)
            return false;
          }
        );
      });
    },

    // addProjectTag removed: the archiving flow no longer adds @project tags. We rely on header-based
    // merging and strip any @project(...) tokens during the merge process.

    addProjectHeaders(doc: Document, data) {
      // For each to-be-archived insert, collect parent project header lines
      Object.keys(data.insert).forEach((ln) => {
        const lineNumber = parseInt(ln, 10);

        const projects = [] as string[];

        AST.walkUp(doc.textDocument, lineNumber, true, true, function ({ line }) {
          if (!Project.is(line.text)) return;

          const parts = line.text.match(Consts.regexes.projectParts);

          if (parts) projects.push(parts[2]);

          // Don't add the project header line to the insert map —
          // keep headers separate from the body to avoid duplicates. The
          // merge helper will create project header chains when needed.
        });

        if (projects.length) {
          data.insert[lineNumber].projects = projects.reverse();
        }
      });
    },

    removeEmptyProjects(doc: Document, data) {
      if (!Config.getKey('archive.remove.emptyProjects')) return;

      const projects = doc.getProjects();
      const archivedLineNumbers = new Set(data.remove.map((line) => line.lineNumber));

      projects.forEach((project) => {
        let isEmpty = true;

        AST.walkDown(
          doc.textDocument,
          project.line.lineNumber,
          true,
          false,
          function ({ startLevel, line, level }) {
            if (startLevel === level) return false;

            if (
              TodoBox.is(line.text) ||
              (!Project.is(line.text) && !archivedLineNumbers.has(line.lineNumber))
            ) {
              return (isEmpty = false);
            }
          }
        );

        if (!isEmpty) return;

        // Only remove an empty header. Standalone notes count as
        // content, and finished task blocks already have insert entries.
        data.remove.push(project.line);
        // For header-only projects, create a header-only insert entry (no text)
        // so that the merge helper creates the project chain in the archive
        // without duplicating project header lines.
        const projectParts = project.line.text.match(Consts.regexes.projectParts);
        const projectChain = projectParts ? [projectParts[2]] : [];
        AST.walkUp(doc.textDocument, project.line.lineNumber, true, true, function ({ line }) {
          if (!Project.is(line.text)) return;

          const parts = line.text.match(Consts.regexes.projectParts);
          if (parts) projectChain.push(parts[2]);
        });

        if (projectChain.length) {
          // Use the project root line number as key for insertion; text = '' means only header should be created
          data.insert[project.line.lineNumber] = data.insert[project.line.lineNumber] || {};
          data.insert[project.line.lineNumber].projects = projectChain.reverse();
          data.insert[project.line.lineNumber].text = '';
        }
      });
    },

    removeEmptyLines(doc: Document, data) {
      const emptyLines = Config.getKey('archive.remove.emptyLines');

      if (emptyLines < 0) return;

      const lines = Array.from(
        { length: doc.textDocument.lineCount },
        (_, lineNumber) => doc.textDocument.lineAt(lineNumber).text
      );
      let archiveLine = data.archiveLine;

      if (typeof archiveLine !== 'number') {
        const archive = doc.getArchive();
        archiveLine = archive ? archive.line.range.start.line : undefined;
      }

      const preserveFromLine = getTrailingEmptySeparatorStart(lines, archiveLine);
      const removedLineNumbers = data.remove.map((line) => line.lineNumber);

      getRemovableEmptyLineNumbers(lines, emptyLines, removedLineNumbers, preserveFromLine).forEach(
        (lineNumber) => {
          data.remove.push(doc.textDocument.lineAt(lineNumber));
        }
      );
    },
  },
};

/* EXPORT */

export default Archive;
