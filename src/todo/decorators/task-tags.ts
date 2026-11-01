import { DecorationRangeBehavior, Range, window } from 'vscode';
import type { DecorationRenderOptions, TextEditorDecorationType } from 'vscode';
import Config from '../../config';
import type Todo from '../items/todo';
import {
  getTaskTagStyleRanges,
  getTaskTagStyleRules,
  resolveTaskTagStyle,
} from '../../utils/task-tag-styles';
import type { TaskTagStyle } from '../../utils/task-tag-styles';

const documents = new Map<object, Map<string, TextEditorDecorationType>>();
const defaultDocument = {};
let signature: string;

export const disposeTaskTagDocument = (document: object) => {
  const types = documents.get(document);
  if (!types) return;
  types.forEach((type) => type.dispose());
  documents.delete(document);
};

export const disposeTaskTagStyles = () => {
  documents.forEach((_types, document) => disposeTaskTagDocument(document));
  signature = undefined;
};

export const pruneTaskTagDocument = (
  document: object,
  retained: Iterable<TextEditorDecorationType>
) => {
  const types = documents.get(document);
  if (!types) return;
  const used = new Set(retained);
  types.forEach((type, key) => {
    if (used.has(type)) return;
    type.dispose();
    types.delete(key);
  });
};

const renderStyle = (style: TaskTagStyle, colors: boolean): DecorationRenderOptions => {
  const options: DecorationRenderOptions = {};
  if (colors && style.color) options.color = style.color;
  if (colors && style.backgroundColor) options.backgroundColor = style.backgroundColor;
  if (style.bold !== undefined) options.fontWeight = style.bold ? 'bold' : 'normal';
  if (style.italic !== undefined) options.fontStyle = style.italic ? 'italic' : 'normal';
  if (style.strikethrough !== undefined)
    options.textDecoration = style.strikethrough ? 'line-through' : 'none';
  return options;
};

export const getTaskTagDecorations = (
  todos: Todo[],
  document: object = defaultDocument,
  prune: boolean = true
) => {
  const config = Config.get(),
    rules = getTaskTagStyleRules(config),
    colors = Config.getKey('colors.enabled') !== false,
    nextSignature = JSON.stringify({ rules, colors });

  if (signature !== nextSignature) {
    disposeTaskTagStyles();
    signature = nextSignature;
  }

  if (!documents.has(document)) documents.set(document, new Map());
  const types = documents.get(document);

  const ranges = new Map<TextEditorDecorationType, Range[]>();
  todos.forEach((todo) => {
    const markdown = !!todo.markdownNode,
      style = resolveTaskTagStyle(todo.text, rules, markdown),
      options: DecorationRenderOptions = {
        ...renderStyle(style.base, colors),
        dark: renderStyle(style.dark, colors),
        light: renderStyle(style.light, colors),
        rangeBehavior: DecorationRangeBehavior.ClosedOpen,
      };
    // An absent theme property inherits the base decoration in VS Code. Keep
    // colors in the theme variants when either theme explicitly clears them.
    for (const property of ['color', 'backgroundColor']) {
      if (style.dark[property] === '' || style.light[property] === '') delete options[property];
    }
    if (
      !Object.keys(style.base).length &&
      !Object.keys(style.dark).length &&
      !Object.keys(style.light).length
    )
      return;

    const key = JSON.stringify(options);
    let type = types.get(key);
    if (!type) {
      type = window.createTextEditorDecorationType(options);
      types.set(key, type);
    }
    if (!ranges.has(type)) ranges.set(type, []);
    getTaskTagStyleRanges(todo.text, markdown).forEach(({ start, end }) => {
      ranges
        .get(type)
        .push(
          new Range(
            todo.range.start.line,
            todo.range.start.character + start,
            todo.range.start.line,
            todo.range.start.character + end
          )
        );
    });
  });

  // Disposing obsolete types clears their editor ranges and bounds the cache by
  // the styles currently used in each document, rather than the edit history.
  if (prune) pruneTaskTagDocument(document, ranges.keys());
  return Array.from(ranges, ([type, ranges]) => ({ type, ranges }));
};
