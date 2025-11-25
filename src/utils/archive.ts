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
import File from './file';
import Folder from './folder';

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

            await Editor.edits.apply(doc.textEditor, [edit]);

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

        let prevFinishedDate: number | Date = -1; // Ensuring comments' position relative to their parent todo is preserved

        function getFinishedDate(line) {
            if (Consts.regexes.todoFinished.test(line)) {
                const match = line.match(Consts.regexes.tagFinished);

                if (match) return (prevFinishedDate = moment(match[1], finishedFormat).toDate());

                return (prevFinishedDate = -1);
            }

            return prevFinishedDate;
        }

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

        Utils.log.debug(
            `Archive.edit: removeLines=${removeLines.length} insertLines=${insertLines.length}`
        );
        removeLines.forEach((line) => {
            edits.push(Editor.edits.makeDeleteLine(line.lineNumber));
        });

        const applyContentToArchiveEditor = async (archivePath: string, content: string) => {
            const editorOpen = vscode.window.visibleTextEditors.find(
                (te) => te.document.uri.fsPath === archivePath
            );

            if (editorOpen) {
                const docLineCount = editorOpen.document.lineCount;
                const lastLineIndex = docLineCount ? docLineCount - 1 : 0;
                const lastLineLength = docLineCount
                    ? editorOpen.document.lineAt(lastLineIndex).text.length
                    : 0;
                const range = new vscode.Range(0, 0, lastLineIndex, lastLineLength);
                await Editor.edits.apply(editorOpen, [vscode.TextEdit.replace(range, content)]);

                const DocumentDecorator = require('../todo/decorators/document').default;
                DocumentDecorator.update(editorOpen, true);
            } else {
                await File.make(archivePath, content);
            }
        };

        if (insertLines.length) {
            Utils.log.debug(`Archive.edit: processing ${insertLines.length} insert items`);
            const config = Config.get();
            // Create helperConfig and set indentation based on the document/editor.
            const helperConfig = Object.assign({}, config);
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

                // Read existing content and append new archive lines
                let content = File.readSync(archivePath) || '';
                if (content.length && !content.endsWith('\n')) content += '\n';
                content = Archive.mergeInsertItemsIntoArchiveContent(
                    content,
                    insertItems,
                    helperConfig
                );

                // Ensure the archive file is updated. If the file is open in the
                // editor, update it via a TextEdit replace to avoid losing
                // syntax highlighting/selection. Otherwise write to disk.
                await applyContentToArchiveEditor(archivePath, content);
            } else if (archiveType === 'InSeparateFile') {
                // Put all archives in a single file at workspace root
                // Put all archives in a single file at workspace root
                const originalPath = doc.textDocument.uri.fsPath;
                const rootPath = Folder.getRootPath(originalPath) || path.dirname(originalPath);
                let archiveFileBase = config.file.name;

                if (_.isString(archiveFileBase) && archiveFileBase.startsWith('.')) {
                    archiveFileBase = archiveFileBase.slice(1);
                }

                const archiveFileName = `ARCHIVE.${archiveFileBase}`;
                const archivePath = path.join(rootPath, archiveFileName);

                let content = File.readSync(archivePath) || '';
                if (content.length && !content.endsWith('\n')) content += '\n';
                content = Archive.mergeInsertItemsIntoArchiveContent(
                    content,
                    insertItems,
                    helperConfig
                );

                await applyContentToArchiveEditor(archivePath, content);
            } else {
                // default behaviour: insert to the same file under the Archive project
                const archive = await Archive.get(doc, true);

                // Compute proper indentation for same-file archive while preserving relative indentation
                const archiveLevel = AST.getLevel(doc.textDocument, archive.line.text);
                const levels = insertItems.map((i) => AST.getLevel(doc.textDocument, i.obj.text));
                const minLevel = Math.min(...levels);

                const indentUnit =
                    (helperConfig as any).indentation || (Consts as any).indentation || '  ';
                const finalLines = insertItems.map((i, idx) => {
                    const rel = levels[idx] - minLevel;
                    const indent = Array(archiveLevel + 1 + rel)
                        .fill(indentUnit)
                        .join('');
                    return `${indent}${_.trimStart(i.obj.text)}`;
                });

                // Tell the helper how many indentation levels should exist at the Archive root.
                helperConfig.rootIndentLevel = archiveLevel + 1;

                // Use the previously prepared helperConfig at top of `insertLines` branch
                const normalizedInsertItems = insertItems.map((it, idx) => ({
                    obj: { ...(it.obj || it), text: finalLines[idx] },
                    lineNumber: it.lineNumber,
                }));

                // Merge into the existing Archive section so we don't duplicate project headers
                const startLine = archive.line.range.start.line + 1;
                const lastLine = doc.textDocument.lineCount - 1;
                const mergedContent = Archive.mergeInsertItemsIntoArchiveContent(
                    doc.textDocument.getText(
                        new vscode.Range(
                            startLine,
                            0,
                            lastLine,
                            doc.textDocument.lineAt(lastLine).text.length
                        )
                    ),
                    normalizedInsertItems,
                    helperConfig
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
        } else {
            Utils.log.debug(`Archive.edit: applying ${edits.length} edits`);
            await Editor.edits.apply(doc.textEditor, edits);
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
                data.insert[line.lineNumber] = { text: line.text };
            });
        },

        addTodosComments(doc: Document, data) {
            data.remove.forEach((line) => {
                AST.walkDown(
                    doc.textDocument,
                    line.lineNumber,
                    true,
                    false,
                    function ({ startLevel, line, level }) {
                        // Include contiguous comments after the todo, at same or deeper indentation
                        if (Comment.is(line.text) && level >= startLevel) {
                            data.remove.push(line);
                            data.insert[line.lineNumber] = { text: line.text }; // Preserve indentation
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

            projects.forEach((project) => {
                const lines = [project.line];

                let isEmpty = true;

                AST.walkDown(
                    doc.textDocument,
                    project.line.lineNumber,
                    true,
                    false,
                    function ({ startLevel, line, level }) {
                        if (startLevel === level) return false;

                        if (TodoBox.is(line.text)) return (isEmpty = false);

                        lines.push(line);
                    }
                );

                if (!isEmpty) return;

                // Add project lines to both remove and insert if the project will be removed
                data.remove.push(...lines);
                // For header-only projects, create a header-only insert entry (no text)
                // so that the merge helper creates the project chain in the archive
                // without duplicating project header lines.
                const projectChain = [] as string[];
                AST.walkUp(
                    doc.textDocument,
                    project.line.lineNumber,
                    true,
                    true,
                    function ({ line }) {
                        if (!Project.is(line.text)) return;

                        const parts = line.text.match(Consts.regexes.projectParts);
                        if (parts) projectChain.push(parts[2]);
                    }
                );

                if (projectChain.length) {
                    // Use the project root line number as key for insertion; text = '' means only header should be created
                    data.insert[project.line.lineNumber] =
                        data.insert[project.line.lineNumber] || {};
                    data.insert[project.line.lineNumber].projects = projectChain.reverse();
                    data.insert[project.line.lineNumber].text = '';
                } else {
                    // For some reason we couldn't compute a chain; fallback: insert header text to preserve behavior
                    lines.forEach((line) => {
                        data.insert[line.lineNumber] = { text: line.text };
                    });
                }
            });
        },

        removeEmptyLines(doc: Document, data) {
            const emptyLines = Config.getKey('archive.remove.emptyLines');

            if (emptyLines < 0) return;

            let streak = 0; // Number of consecutive empty lines

            AST.walkDown(
                doc.textDocument,
                -1,
                false,
                false,
                function ({ startLevel, line, level }) {
                    if (data.remove.find((other) => other === line)) return;

                    if (line.text && !Consts.regexes.empty.test(line.text)) {
                        streak = 0;
                    } else {
                        streak++;

                        if (streak > emptyLines) {
                            data.remove.push(line);
                        }
                    }
                }
            );
        },
    },
};

/* EXPORT */

export default Archive;
