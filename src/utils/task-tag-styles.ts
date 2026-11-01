import { getInlineCodeRanges, maskInlineCode } from './todo-status';
import { getMarkdownTaskProtectedRanges, maskMarkdownTaskText } from './markdown-task-text';

export interface TaskTagStyle {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
}

export interface TaskTagStyleRule extends TaskTagStyle {
  priority?: number;
  dark?: TaskTagStyle;
  light?: TaskTagStyle;
}

export type TaskTagStyleRules = { [tag: string]: TaskTagStyleRule | false };

export interface ResolvedTaskTagStyle {
  base: TaskTagStyle;
  dark: TaskTagStyle;
  light: TaskTagStyle;
}

const styleProperties = ['color', 'backgroundColor', 'bold', 'italic', 'strikethrough'];

const readStyle = (value): TaskTagStyle => {
  const style: TaskTagStyle = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return style;

  styleProperties.forEach((property) => {
    const expectedType =
      property === 'color' || property === 'backgroundColor' ? 'string' : 'boolean';
    if (typeof value[property] === expectedType) style[property] = value[property];
  });
  return style;
};

// The legacy settings remain the appearance defaults for the built-in rules.
// Explicit rule properties override them, including their theme variants.
export const getTaskTagStyleRules = (config): TaskTagStyleRules => {
  const colors = config.colors || {},
    builtIn = (name: string, fallback: string, priority: number): TaskTagStyleRule => {
      const color = typeof colors[name] === 'string' ? colors[name] : fallback;
      return {
        color,
        priority,
        dark: { color: (colors.dark || {})[name] || color },
        light: { color: (colors.light || {})[name] || color },
      };
    },
    defaults: TaskTagStyleRules = {
      done: {
        ...builtIn('done', '#a6e22e', 100),
        strikethrough: !config.decorations || config.decorations.done?.strikethrough !== false,
      },
      cancelled: builtIn('cancelled', '#f92672', 100),
      started: builtIn('started', '#4fc1ff', 10),
      paused: { color: '#e5d145', priority: 20 },
    },
    configured = config.tags && config.tags.styles,
    rules: TaskTagStyleRules = Object.create(null);

  Object.keys(defaults).forEach((name) => (rules[name] = defaults[name]));
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) return rules;

  Object.keys(configured).forEach((name) => {
    const value = configured[name];
    if (value === false) {
      rules[name] = false;
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const previous = rules[name] || {},
      style = readStyle(value);
    rules[name] = {
      ...previous,
      ...style,
      priority: Number.isFinite(value.priority) ? value.priority : previous.priority || 0,
      dark: { ...previous.dark, ...style, ...readStyle(value.dark) },
      light: { ...previous.light, ...style, ...readStyle(value.light) },
    };
  });
  return rules;
};

const getTags = (text: string, markdown: boolean) => {
  const masked = markdown ? maskMarkdownTaskText(text) : maskInlineCode(text),
    regex = /(?<![a-zA-Z0-9@])@([^\s*~(`@]+)(?:\([^\r\n)]*\))?/g,
    tags: { name: string; start: number; end: number }[] = [];
  let match: RegExpExecArray;

  while ((match = regex.exec(masked))) {
    tags.push({ name: match[1], start: match.index, end: regex.lastIndex });
  }
  return tags;
};

export const resolveTaskTagStyle = (
  text: string,
  rules: TaskTagStyleRules,
  markdown: boolean = false
): ResolvedTaskTagStyle => {
  const result: ResolvedTaskTagStyle = { base: {}, dark: {}, light: {} };
  const matches = getTags(text, markdown)
    .map((tag) => {
      const name = Object.prototype.hasOwnProperty.call(rules, tag.name)
        ? tag.name
        : tag.name.replace(/[.,;:!?()[\]{}<>"']+$/, '');
      return { ...tag, rule: Object.prototype.hasOwnProperty.call(rules, name) && rules[name] };
    })
    .filter((tag): tag is typeof tag & { rule: TaskTagStyleRule } => !!tag.rule)
    .sort(
      (left, right) =>
        (left.rule.priority || 0) - (right.rule.priority || 0) || left.start - right.start
    );

  matches.forEach(({ rule }) => {
    const style = readStyle(rule);
    Object.assign(result.base, style);
    Object.assign(result.dark, style, readStyle(rule.dark));
    Object.assign(result.light, style, readStyle(rule.light));
  });
  return result;
};

// Preserve the independent styling of tag labels and inline code spans.
export const getTaskTagStyleRanges = (
  text: string,
  markdown: boolean = false
): { start: number; end: number }[] => {
  const protectedRanges = markdown
    ? getMarkdownTaskProtectedRanges(text)
    : getInlineCodeRanges(text);
  const excluded = [...getTags(text, markdown), ...protectedRanges].sort(
      (a, b) => a.start - b.start
    ),
    ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  excluded.forEach(({ start, end }) => {
    if (cursor < start) ranges.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) ranges.push({ start: cursor, end: text.length });
  return ranges;
};
