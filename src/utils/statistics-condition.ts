type Scalar = string | number | boolean | null | undefined;
type StatisticsTokens = { [token: string]: any };
type Scope = 'global' | 'project';
type Expression =
  | { type: 'literal'; value: Scalar }
  | { type: 'scope'; scope: Scope }
  | { type: 'token'; scope: Scope; name: string }
  | { type: 'unary'; operator: string; operand: Expression }
  | { type: 'binary'; operator: string; left: Expression; right: Expression }
  | { type: 'conditional'; test: Expression; positive: Expression; negative: Expression };

interface Token {
  type: 'literal' | 'identifier' | 'operator';
  text: string;
  value?: Scalar;
}

const precedence = new Map([
  ['||', 1],
  ['&&', 2],
  ['==', 3],
  ['!=', 3],
  ['===', 3],
  ['!==', 3],
  ['<', 4],
  ['<=', 4],
  ['>', 4],
  ['>=', 4],
  ['+', 5],
  ['-', 5],
  ['*', 6],
  ['/', 6],
  ['%', 6],
]);
const forbiddenProperties = new Set(['constructor', 'prototype', '__proto__']);
const expressions = new Map<string, Expression>();
const stringEscapes = new Map([
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['b', '\b'],
  ['f', '\f'],
  ['v', '\v'],
  ['0', '\0'],
  ['\\', '\\'],
  ['"', '"'],
  ["'", "'"],
]);

const tokenize = (condition: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < condition.length) {
    const char = condition[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      let value = '',
        closed = false;
      index++;
      while (index < condition.length) {
        const next = condition[index++];
        if (next === char) {
          closed = true;
          break;
        }
        if (next === '\n' || next === '\r') throw new Error('Invalid string literal');
        if (next !== '\\') {
          value += next;
          continue;
        }
        const escaped = condition[index++];
        if (escaped === 'u' || escaped === 'x') {
          const length = escaped === 'u' ? 4 : 2,
            digits = condition.slice(index, index + length);
          if (digits.length !== length || !/^[0-9a-f]+$/i.test(digits)) {
            throw new Error('Invalid string escape');
          }
          value += String.fromCharCode(parseInt(digits, 16));
          index += length;
        } else if (stringEscapes.has(escaped)) {
          value += stringEscapes.get(escaped);
        } else {
          throw new Error('Invalid string escape');
        }
      }
      if (!closed) throw new Error('Unclosed string literal');
      tokens.push({ type: 'literal', text: value, value });
      continue;
    }
    const remaining = condition.slice(index),
      number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(remaining),
      identifier = /^[a-z_$][\w$]*/i.exec(remaining),
      operator = /^(?:===|!==|==|!=|<=|>=|&&|\|\||[!+*/%<>?:().\[\]-])/.exec(remaining);

    if (number) {
      tokens.push({ type: 'literal', text: number[0], value: Number(number[0]) });
      index += number[0].length;
    } else if (identifier) {
      tokens.push({ type: 'identifier', text: identifier[0] });
      index += identifier[0].length;
    } else if (operator) {
      tokens.push({ type: 'operator', text: operator[0] });
      index += operator[0].length;
    } else {
      throw new Error('Unsupported condition syntax');
    }
  }
  return tokens;
};

const parseCondition = (condition: string): Expression => {
  const tokens = tokenize(condition);
  let index = 0,
    depth = 0;
  const matches = (text: string) =>
    tokens[index] && tokens[index].type === 'operator' && tokens[index].text === text;
  const consume = (text: string) => {
    if (!matches(text)) throw new Error(`Expected ${text}`);
    index++;
  };

  const primary = (): Expression => {
    const token = tokens[index++];
    if (!token) throw new Error('Missing operand');
    if (token.type === 'literal') return { type: 'literal', value: token.value };
    if (token.type === 'operator') {
      if (token.text === '(') {
        const result = expression();
        consume(')');
        return result;
      }
      if (['!', '+', '-'].includes(token.text)) {
        return { type: 'unary', operator: token.text, operand: expression(7) };
      }
    }
    if (token.type !== 'identifier') throw new Error('Invalid operand');
    if (['true', 'false', 'null', 'undefined'].includes(token.text)) {
      return {
        type: 'literal',
        value:
          token.text === 'true'
            ? true
            : token.text === 'false'
              ? false
              : token.text === 'null'
                ? null
                : undefined,
      };
    }
    if (token.text !== 'global' && token.text !== 'project') {
      throw new Error('Only global and project statistics are available');
    }
    const scope = token.text;
    let property: Token;
    if (matches('.')) {
      index++;
      property = tokens[index++];
      if (!property || property.type !== 'identifier') throw new Error('Invalid token');
    } else if (matches('[')) {
      index++;
      property = tokens[index++];
      if (!property || property.type !== 'literal' || typeof property.value !== 'string') {
        throw new Error('A token name must be a string literal');
      }
      consume(']');
    }
    if (!property) return { type: 'scope', scope };
    if (forbiddenProperties.has(property.text)) throw new Error('Forbidden token name');
    return { type: 'token', scope, name: property.text };
  };

  const expression = (minimumPrecedence = 0): Expression => {
    if (++depth > 100) throw new Error('Condition is too deeply nested');
    let left = primary();
    while (index < tokens.length) {
      const token = tokens[index],
        priority = token.type === 'operator' ? precedence.get(token.text) : undefined;
      if (priority === undefined || priority < minimumPrecedence) break;
      index++;
      left = { type: 'binary', operator: token.text, left, right: expression(priority + 1) };
    }
    if (minimumPrecedence === 0 && matches('?')) {
      index++;
      const positive = expression();
      consume(':');
      left = { type: 'conditional', test: left, positive, negative: expression() };
    }
    depth--;
    return left;
  };

  const result = expression();
  if (index !== tokens.length) throw new Error('Unexpected condition syntax');
  return result;
};

const scalar = (value: any): Scalar => {
  if (value === null || ['undefined', 'string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }
  throw new Error('Only scalar statistics values can be compared');
};

const evaluate = (
  node: Expression,
  scopes: { global?: StatisticsTokens; project?: StatisticsTokens }
): any => {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'scope':
      return scopes[node.scope];
    case 'token': {
      const tokens = scopes[node.scope];
      if (!tokens) throw new Error('Missing statistics scope');
      // StatisticsTokens exposes computed values as prototype getters.
      // Read one named token only, without exposing its object or methods.
      return scalar(tokens[node.name]);
    }
    case 'unary': {
      const value = evaluate(node.operand, scopes);
      if (node.operator === '!') return !value;
      return node.operator === '+' ? +scalar(value) : -scalar(value);
    }
    case 'conditional':
      return evaluate(evaluate(node.test, scopes) ? node.positive : node.negative, scopes);
    case 'binary': {
      const left = evaluate(node.left, scopes);
      if (node.operator === '&&') return left && evaluate(node.right, scopes);
      if (node.operator === '||') return left || evaluate(node.right, scopes);
      const first: any = scalar(left),
        second: any = scalar(evaluate(node.right, scopes));
      switch (node.operator) {
        case '+':
          return first + second;
        case '-':
          return first - second;
        case '*':
          return first * second;
        case '/':
          return first / second;
        case '%':
          return first % second;
        case '<':
          return first < second;
        case '<=':
          return first <= second;
        case '>':
          return first > second;
        case '>=':
          return first >= second;
        case '==':
          return first == second;
        case '!=':
          return first != second;
        case '===':
          return first === second;
        case '!==':
          return first !== second;
      }
    }
  }
};

export const evaluateStatisticsCondition = (
  condition: boolean | string,
  globalTokens?: StatisticsTokens,
  projectTokens?: StatisticsTokens
): boolean => {
  if (typeof condition === 'boolean') return condition;
  if (!globalTokens && !projectTokens) return false;
  if (typeof condition !== 'string' || condition.length > 4096) return false;

  try {
    let expression = expressions.get(condition);
    if (!expression) {
      expression = parseCondition(condition);
      if (expressions.size >= 100) expressions.delete(expressions.keys().next().value);
      expressions.set(condition, expression);
    }
    return !!evaluate(expression, { global: globalTokens, project: projectTokens });
  } catch (error) {
    return false;
  }
};
