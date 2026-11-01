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

const types = new Map<string, TextEditorDecorationType>();
let signature: string;

export const disposeTaskTagStyles = () => {
  types.forEach((type) => type.dispose());
  types.clear();
  signature = undefined;
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

export const getTaskTagDecorations = (todos: Todo[]) => {
  const config = Config.get(),
    rules = getTaskTagStyleRules(config),
    colors = Config.getKey('colors.enabled') !== false,
    nextSignature = JSON.stringify({ rules, colors });

  if (signature !== nextSignature) {
    disposeTaskTagStyles();
    signature = nextSignature;
  }

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

  // Empty ranges clear styles when tags are removed or a rule stops matching.
  return Array.from(types.values()).map((type) => ({ type, ranges: ranges.get(type) || [] }));
};
