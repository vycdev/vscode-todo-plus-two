import * as fs from 'fs';
import type { TextDocument } from 'vscode';
import { getFilePathKey } from '../file-globs';

// Keep bindings across provider resets, but let closed documents be collected.
const identities = new WeakMap<TextDocument, { uri: string; key: string }>();

export const isEmbeddedDocumentCurrent = (document: TextDocument, key: string): boolean => {
  const uri = getFilePathKey(document.uri.fsPath);
  const identity = identities.get(document);

  if (!identity || identity.uri !== uri || identity.key === key) {
    identities.set(document, { uri, key });
    return true;
  }

  // A dirty alias buffer still belongs to the old target. A clean buffer can
  // rebind after VS Code reloads it, once its text agrees with the new file.
  if (document.isDirty === false) {
    try {
      if (fs.readFileSync(document.uri.fsPath, 'utf8') === document.getText()) {
        identities.set(document, { uri, key });
        return true;
      }
    } catch {
      // Missing or unreadable targets cannot establish a new binding.
    }
  }

  return false;
};
