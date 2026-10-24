import * as fs from 'fs';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import File from './file';

const transactions = new Map<string, Promise<void>>();
const uriKey = (uri: vscode.Uri) =>
  process.platform === 'win32' ? uri.toString().toLowerCase() : uri.toString();

const readArchive = (archivePath: string) => {
  try {
    return fs.readFileSync(archivePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return '';
  }
};

const writeArchive = async (archivePath: string, content: string, beforeReplace: () => boolean) => {
  const temporaryPath = `${archivePath}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    // Replacing only after the complete write protects the existing archive
    // from truncation when a disk write fails partway through.
    await File.make(temporaryPath, content);
    if (beforeReplace()) fs.renameSync(temporaryPath, archivePath);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      // A successful rename removes the temporary path. Cleanup failures
      // must not hide the original write error or undo a successful move.
    }
  }
};

const transferToArchive = async (
  archivePath: string,
  source: vscode.TextDocument,
  sourceEdits: vscode.TextEdit[],
  mergeContent: (content: string) => string,
  sourceVersion: number
) => {
  const ensureSourceUnchanged = () => {
    if (source.version !== sourceVersion) {
      throw new Error('The source changed while archiving. Source tasks were kept');
    }
  };
  ensureSourceUnchanged();

  const archiveUri = vscode.Uri.file(archivePath),
    findArchiveDocument = () =>
      vscode.workspace.textDocuments.find(
        (document) => uriKey(document.uri) === uriKey(archiveUri)
      ),
    archiveDocument = findArchiveDocument();

  if (uriKey(archiveUri) === uriKey(source.uri)) {
    throw new Error('The archive destination must be different from the source file');
  }

  let content: string;

  if (archiveDocument) {
    content = archiveDocument.getText();
  } else {
    content = readArchive(archivePath);
  }

  const mergedContent = mergeContent(content),
    edit = new vscode.WorkspaceEdit();

  edit.set(source.uri, sourceEdits);

  const replaceArchiveBuffer = (document: vscode.TextDocument) => {
    const bufferContent = document.getText();
    // One workspace edit makes archive insertion and source removal a
    // single operation, including when the archive tab is hidden or dirty.
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(bufferContent.length)),
      mergeContent(bufferContent)
    );
  };

  if (archiveDocument) {
    replaceArchiveBuffer(archiveDocument);
  } else {
    // Persist closed archives before editing the source. A failed write
    // never removes tasks from their source.
    await writeArchive(archivePath, mergedContent, () => {
      ensureSourceUnchanged();
      const openedArchive = findArchiveDocument();
      if (!openedArchive) {
        if (readArchive(archivePath) !== content) {
          throw new Error('The archive changed while writing. Source tasks were kept');
        }
        return true;
      }
      replaceArchiveBuffer(openedArchive);
      return false;
    });
  }

  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error('Unable to apply the archive edits. Source tasks were kept');
  }
};

/** Serialize read/merge/write operations so simultaneous archives cannot overwrite each other. */
export const archiveToFile = (
  archivePath: string,
  source: vscode.TextDocument,
  sourceEdits: vscode.TextEdit[],
  mergeContent: (content: string) => string
): Promise<void> => {
  const key = uriKey(vscode.Uri.file(archivePath)),
    sourceVersion = source.version,
    previous = transactions.get(key) || Promise.resolve(),
    transaction = previous
      .catch(() => undefined)
      .then(() => transferToArchive(archivePath, source, sourceEdits, mergeContent, sourceVersion));

  transactions.set(key, transaction);
  const cleanup = () => {
    if (transactions.get(key) === transaction) transactions.delete(key);
  };
  transaction.then(cleanup, cleanup);
  return transaction;
};
