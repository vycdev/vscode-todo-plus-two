import { version, workspace } from 'vscode';
import type { TextDocument, WorkspaceConfiguration } from 'vscode';

export const getEditorSetting = <T>(document: TextDocument, setting: string): T | undefined => {
  const [major, minor] = version.split('.').map(Number);

  if (major > 1 || (major === 1 && minor >= 42)) {
    // Language-aware configuration scopes were added in 1.42. Keep compiling
    // against 1.36 while using the full settings precedence on newer hosts.
    const getConfiguration = workspace.getConfiguration as unknown as (
      section: string,
      scope: Pick<TextDocument, 'uri' | 'languageId'>
    ) => WorkspaceConfiguration;

    return getConfiguration('editor', {
      uri: document.uri,
      languageId: document.languageId,
    }).get<T>(setting);
  }

  const overrides = workspace
    .getConfiguration(undefined, document.uri)
    .get<{ [key: string]: T }>(`[${document.languageId}]`);
  const key = `editor.${setting}`;

  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];

  return workspace.getConfiguration('editor', document.uri).get<T>(setting);
};
