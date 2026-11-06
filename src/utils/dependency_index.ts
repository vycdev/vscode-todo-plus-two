/* IMPORT */

import * as vscode from 'vscode';
import Consts from '../consts';
import { DependencyReference, DependencyTarget, getDependencies, getIds } from './dependencies';
import Files from './files';
import Folder from './folder';
import Regex from './regex';
import { debounceRefresh } from './refresh-delay';
import { matchesTodoStatus } from './todo-status';
import {
  getMarkdownTaskNodes,
  getMarkdownTaskSettings,
  isMarkdownTaskDocument,
  isTaskDocument,
  MarkdownTaskSettings,
} from './task-source';
import { maskMarkdownTaskText } from './markdown-task-text';
import { findClosestRootPath, getFilePathKey } from './file-globs';
import { getCodeBlocks } from './code-blocks';
import type { MarkdownTaskNode } from './markdown-tasks';

/* TYPES */

interface DependencyIndex {
  targets: { [id: string]: DependencyTarget[] };
  dependencies: { [id: string]: DependencyTarget[] };
}

interface DocumentReferences {
  version: number;
  signature: string;
  targets: DependencyTarget[];
  dependencies: DependencyTarget[];
}

// References per buffer, so a refresh after an edit only rescans the edited file.
const documentReferences = new WeakMap<vscode.TextDocument, DocumentReferences>();

/* DEPENDENCY INDEX */

const DependencyIndex = {
  diagnostics: <vscode.DiagnosticCollection>undefined,
  diagnosticsGeneration: 0,

  initialize(context: vscode.ExtensionContext) {
    if (DependencyIndex.diagnostics) return;

    DependencyIndex.diagnostics = vscode.languages.createDiagnosticCollection('todo-dependencies');

    const updateDiagnostics = debounceRefresh(() => DependencyIndex.updateDiagnostics());

    context.subscriptions.push(
      DependencyIndex.diagnostics,
      {
        dispose: () => {
          updateDiagnostics.cancel();
          DependencyIndex.diagnosticsGeneration++;
          DependencyIndex.diagnostics = undefined;
        },
      },
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (isTaskDocument(document)) updateDiagnostics();
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isTaskDocument(document)) updateDiagnostics();
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (!isTaskDocument(document)) return;
        if (document.isDirty) Files.invalidateDocument(document);
        updateDiagnostics();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(updateDiagnostics),
      vscode.workspace.onDidChangeConfiguration(updateDiagnostics)
    );

    DependencyIndex.updateDiagnostics();
  },

  async get(document?: vscode.TextDocument): Promise<DependencyIndex> {
    const settings = getMarkdownTaskSettings();
    const documents = await DependencyIndex.getTodoDocuments(document, settings);
    const targets: { [id: string]: DependencyTarget[] } = Object.create(null);
    const dependencies: { [id: string]: DependencyTarget[] } = Object.create(null);

    documents.forEach((candidate) => {
      const references = DependencyIndex.getDocumentReferences(candidate, settings);

      references.dependencies.forEach((dependency) => {
        if (!dependencies[dependency.id]) dependencies[dependency.id] = [];

        dependencies[dependency.id].push(dependency);
      });

      references.targets.forEach((target) => {
        if (!targets[target.id]) targets[target.id] = [];

        targets[target.id].push(target);
      });
    });

    return { targets, dependencies };
  },

  getDocumentReferences(
    candidate: vscode.TextDocument,
    settings: MarkdownTaskSettings
  ): DocumentReferences {
    const markdown = isMarkdownTaskDocument(candidate, settings);
    const signature = markdown
      ? `markdown:${settings.signature}`
      : `todo:${String(Consts.regexes.todo)}`;
    const cached = documentReferences.get(candidate);

    if (
      cached &&
      typeof candidate.version === 'number' &&
      cached.version === candidate.version &&
      cached.signature === signature
    ) {
      return cached;
    }

    const references: DocumentReferences = {
      version: candidate.version,
      signature,
      targets: [],
      dependencies: [],
    };
    let markdownTasks: Map<number, MarkdownTaskNode>;
    if (markdown) {
      markdownTasks = new Map();
      getMarkdownTaskNodes(candidate, settings).forEach((node) => {
        if (node.kind === 'todo' && !markdownTasks.has(node.lineNumber)) {
          markdownTasks.set(node.lineNumber, node);
        }
      });
    }
    const code = markdownTasks ? undefined : getCodeBlocks(candidate);
    const lineNumbers = markdownTasks
      ? Array.from(markdownTasks.keys()).sort((a, b) => a - b)
      : Array.from({ length: candidate.lineCount }, (_line, lineNumber) => lineNumber);

    lineNumbers.forEach((lineNumber) => {
      if (code && code.byLine.has(lineNumber)) return;
      const text = candidate.lineAt(lineNumber).text;
      const markdownTask = markdownTasks && markdownTasks.get(lineNumber);
      if (!markdownTask && !Regex.test(Consts.regexes.todo, text)) return;

      const makeLocation = (reference: DependencyReference): DependencyTarget => ({
        ...reference,
        filePath: candidate.uri.fsPath,
        lineNumber,
        text,
        status: markdownTask ? markdownTask.status : undefined,
      });

      const referenceText = markdownTask ? maskMarkdownTaskText(text) : text;
      getDependencies(referenceText).forEach((reference) => {
        references.dependencies.push(makeLocation(reference));
      });

      getIds(referenceText).forEach((reference) => {
        references.targets.push(makeLocation(reference));
      });
    });

    documentReferences.set(candidate, references);

    return references;
  },

  isFinished(target: DependencyTarget) {
    if (target.status) return target.status !== 'box';
    return matchesTodoStatus(target.text, Consts.regexes.todoFinished);
  },

  async updateDiagnostics(document?: vscode.TextDocument) {
    if (!DependencyIndex.diagnostics) return;

    const generation = ++DependencyIndex.diagnosticsGeneration;
    const index = await DependencyIndex.get(document);

    if (generation !== DependencyIndex.diagnosticsGeneration) return;

    const diagnostics: { [filePath: string]: vscode.Diagnostic[] } = Object.create(null);

    Object.keys(index.dependencies).forEach((id) => {
      if (index.targets[id] && index.targets[id].length) return;

      index.dependencies[id].forEach((dependency) => {
        if (!dependency.filePath) return;

        const range = new vscode.Range(
          dependency.lineNumber,
          dependency.tagStart,
          dependency.lineNumber,
          dependency.tagEnd
        );
        const diagnostic = new vscode.Diagnostic(
          range,
          `No task has @id(${id})`,
          vscode.DiagnosticSeverity.Warning
        );

        diagnostic.source = 'Todo+';

        if (!diagnostics[dependency.filePath]) diagnostics[dependency.filePath] = [];

        diagnostics[dependency.filePath].push(diagnostic);
      });
    });

    DependencyIndex.diagnostics.clear();

    Object.keys(diagnostics).forEach((filePath) => {
      DependencyIndex.diagnostics.set(vscode.Uri.file(filePath), diagnostics[filePath]);
    });
  },

  async getTodoDocuments(
    document?: vscode.TextDocument,
    settings: MarkdownTaskSettings = getMarkdownTaskSettings()
  ) {
    const rootPaths = Folder.getAllRootPaths();
    const documents: vscode.TextDocument[] = [];
    const seen = new Set<string>();
    const add = (candidate: vscode.TextDocument) => {
      const key = candidate.uri.toString();

      if (seen.has(key)) return;

      seen.add(key);
      documents.push(candidate);
    };
    let fileDocuments: { [filePath: string]: vscode.TextDocument } = Object.create(null);
    let discovered: Set<string>;

    try {
      // Reuse the documents the Files service already loaded and watches.
      // Reopening every file here made VS Code close older ones, and each
      // close event started another full pass.
      fileDocuments = await Files.getDocuments(rootPaths);
      discovered = new Set(Object.keys(fileDocuments).map((filePath) => getFilePathKey(filePath)));
    } catch (error) {
      console.warn('Todo+: failed to scan workspace todo files', error);
    }

    // Open buffers come first so unsaved edits win over a stale loaded copy.
    vscode.workspace.textDocuments.forEach((candidate) => {
      if (!isTaskDocument(candidate, settings)) return;
      if (
        discovered &&
        isMarkdownTaskDocument(candidate, settings) &&
        candidate.uri.scheme === 'file' &&
        findClosestRootPath(candidate.uri.fsPath, rootPaths) &&
        !discovered.has(getFilePathKey(candidate.uri.fsPath))
      )
        return;

      add(candidate);
    });

    Object.keys(fileDocuments).forEach((filePath) => add(fileDocuments[filePath]));

    if (document) add(document);

    return documents;
  },
};

/* EXPORT */

export default DependencyIndex;
