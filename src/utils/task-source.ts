import type { TextDocument, TextEditor } from 'vscode';
import Config from '../config';
import { MarkdownTaskNode, parseMarkdownTasks } from './markdown-tasks';

const snapshots = new WeakMap<
  TextDocument,
  { version: number; signature: string; nodes: MarkdownTaskNode[] }
>();

export const getMarkdownTaskOptions = () => ({
  scope: Config.getKey('markdown.scope'),
  sections: Config.getKey('markdown.sections'),
  archiveName: Config.getKey('archive.name'),
  symbols: Config.getKey('symbols'),
});

export interface MarkdownTaskSettings {
  enabled: boolean;
  options: ReturnType<typeof getMarkdownTaskOptions>;
  signature: string;
}

// Each setting read rebuilds VS Code's configuration object. Loops over every
// workspace file share one snapshot, which reads each value on first use only.
export const getMarkdownTaskSettings = (): MarkdownTaskSettings => {
  let enabled: boolean, options: MarkdownTaskSettings['options'], signature: string;
  return {
    get enabled() {
      if (enabled === undefined) enabled = Config.getKey('markdown.enabled') !== false;
      return enabled;
    },
    get options() {
      return options || (options = getMarkdownTaskOptions());
    },
    get signature() {
      return signature || (signature = JSON.stringify(this.options));
    },
  };
};

export const isMarkdownTaskDocument = (
  document: TextDocument,
  settings?: Pick<MarkdownTaskSettings, 'enabled'>
): boolean =>
  !!document &&
  document.languageId === 'markdown' &&
  (settings ? settings.enabled : Config.getKey('markdown.enabled') !== false);

export const isTaskDocument = (
  document: TextDocument,
  settings?: Pick<MarkdownTaskSettings, 'enabled'>
): boolean =>
  !!document && (document.languageId === 'todo' || isMarkdownTaskDocument(document, settings));

export const getMarkdownTaskNodes = (
  document: TextDocument,
  settings?: MarkdownTaskSettings
): MarkdownTaskNode[] => {
  const options = settings ? settings.options : getMarkdownTaskOptions();
  const signature = settings ? settings.signature : JSON.stringify(options);
  const cached = snapshots.get(document);
  if (cached && cached.version === document.version && cached.signature === signature)
    return cached.nodes;
  const nodes = parseMarkdownTasks(document.getText(), options);
  snapshots.set(document, { version: document.version, signature, nodes });
  return nodes;
};

export const getTaskLevel = (
  document: TextDocument,
  line: number,
  fallback: () => number
): number => {
  if (!isMarkdownTaskDocument(document)) return fallback();
  const node = getMarkdownTaskNodes(document).find((candidate) => candidate.lineNumber === line);
  return node ? node.level : -1;
};

export const isTaskEditor = (editor?: TextEditor): boolean =>
  !!editor && isTaskDocument(editor.document);

export const getTaskFileIncludes = (config): string[] =>
  (config.file.include || []).concat(
    config.markdown && config.markdown.enabled !== false ? config.markdown.include || [] : []
  );
