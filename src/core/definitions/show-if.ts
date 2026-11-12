/**
 * Evaluator for VIA `showIf` expressions, such as
 * `{id_qmk_rgb_matrix_effect} != 0 && {id_qmk_rgb_matrix_effect} != 24`.
 *
 * VIA uses @the-via/pelpi for this. This is a small independent parser for
 * the same expression shape, so the core needs no extra runtime dependency.
 *
 * Grammar:
 *   expr    := or
 *   or      := and ('||' and)*
 *   and     := unary ('&&' unary)*
 *   unary   := '!' unary | compare
 *   compare := primary (('==' | '!=' | '<' | '<=' | '>' | '>=') primary)?
 *   primary := number | '{' identifier ('.' index)? '}' | '(' expr ')'
 *
 * `{id}` is byte 0 of the value read for `id`; `{id.1}` is byte 1.
 */
import {ValidationError} from '../protocol/errors.ts';

export type ShowIfValues = Readonly<Record<string, readonly number[] | undefined>>;

type Token =
  | {readonly kind: 'number'; readonly value: number}
  | {readonly kind: 'ref'; readonly id: string; readonly index: number}
  | {readonly kind: 'op'; readonly op: string};

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const ref = /^\{\s*([A-Za-z_][\w]*)(?:\.(\d+))?\s*\}/.exec(rest);
    if (ref) {
      tokens.push({kind: 'ref', id: ref[1] ?? '', index: Number(ref[2] ?? 0)});
      i += ref[0].length;
      continue;
    }
    const num = /^(0x[0-9a-fA-F]+|\d+)/.exec(rest);
    if (num) {
      tokens.push({kind: 'number', value: Number(num[1])});
      i += num[0].length;
      continue;
    }
    const op = /^(==|!=|<=|>=|&&|\|\||[<>!()])/.exec(rest);
    if (op) {
      tokens.push({kind: 'op', op: op[1] ?? ''});
      i += op[0].length;
      continue;
    }
    throw new ValidationError(`showIf: unexpected "${rest.slice(0, 10)}" in "${source}"`);
  }
  return tokens;
};

type Node =
  | {readonly kind: 'number'; readonly value: number}
  | {readonly kind: 'ref'; readonly id: string; readonly index: number}
  | {readonly kind: 'not'; readonly operand: Node}
  | {readonly kind: 'binary'; readonly op: string; readonly left: Node; readonly right: Node};

const parse = (source: string): Node => {
  const tokens = tokenize(source);
  let pos = 0;
  const peekOp = (): string | undefined => {
    const token = tokens[pos];
    return token?.kind === 'op' ? token.op : undefined;
  };
  const fail = (message: string): never => {
    throw new ValidationError(`showIf: ${message} in "${source}"`);
  };
  const primary = (): Node => {
    const token = tokens[pos++];
    if (!token) {
      return fail('unexpected end');
    }
    if (token.kind === 'number' || token.kind === 'ref') {
      return token;
    }
    if (token.op === '(') {
      const inner = or();
      if (peekOp() !== ')') {
        fail("missing ')'");
      }
      pos++;
      return inner;
    }
    return fail(`unexpected "${token.op}"`);
  };
  const compare = (): Node => {
    const left = primary();
    const op = peekOp();
    if (op && ['==', '!=', '<', '<=', '>', '>='].includes(op)) {
      pos++;
      return {kind: 'binary', op, left, right: primary()};
    }
    return left;
  };
  const unary = (): Node => {
    if (peekOp() === '!') {
      pos++;
      return {kind: 'not', operand: unary()};
    }
    return compare();
  };
  const and = (): Node => {
    let left = unary();
    while (peekOp() === '&&') {
      pos++;
      left = {kind: 'binary', op: '&&', left, right: unary()};
    }
    return left;
  };
  const or = (): Node => {
    let left = and();
    while (peekOp() === '||') {
      pos++;
      left = {kind: 'binary', op: '||', left, right: and()};
    }
    return left;
  };
  const tree = or();
  if (pos !== tokens.length) {
    fail('unexpected trailing input');
  }
  return tree;
};

class MissingValue extends Error {}

const evaluate = (node: Node, values: ShowIfValues): number => {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'ref': {
      const value = values[node.id]?.[node.index];
      if (value === undefined) {
        throw new MissingValue(node.id);
      }
      return value;
    }
    case 'not':
      return evaluate(node.operand, values) ? 0 : 1;
    case 'binary': {
      if (node.op === '&&') {
        return evaluate(node.left, values) && evaluate(node.right, values) ? 1 : 0;
      }
      if (node.op === '||') {
        return evaluate(node.left, values) || evaluate(node.right, values) ? 1 : 0;
      }
      const left = evaluate(node.left, values);
      const right = evaluate(node.right, values);
      switch (node.op) {
        case '==':
          return left === right ? 1 : 0;
        case '!=':
          return left !== right ? 1 : 0;
        case '<':
          return left < right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
        default:
          throw new ValidationError(`showIf: unknown operator ${node.op}`);
      }
    }
    default: {
      const unreachable: never = node;
      throw new ValidationError(`showIf: bad node ${JSON.stringify(unreachable)}`);
    }
  }
};

const cache = new Map<string, Node>();

/** Parses a showIf expression, throwing a ValidationError if it is malformed. */
export const parseShowIf = (expression: string): void => {
  if (!cache.has(expression)) {
    cache.set(expression, parse(expression));
  }
};

/**
 * Evaluates a showIf expression. When a referenced value has not been read
 * yet, returns `whenUnknown` (default true, so controls stay visible while
 * values load).
 */
export const evaluateShowIf = (expression: string | undefined, values: ShowIfValues, whenUnknown = true): boolean => {
  if (expression === undefined || expression.trim() === '') {
    return true;
  }
  let tree = cache.get(expression);
  if (!tree) {
    tree = parse(expression);
    cache.set(expression, tree);
  }
  try {
    return evaluate(tree, values) !== 0;
  } catch (error) {
    if (error instanceof MissingValue) {
      return whenUnknown;
    }
    throw error;
  }
};
