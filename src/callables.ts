import type { SgNode } from "@ast-grep/napi";
import { codeLinesIn, type Source } from "./source.ts";
import type { Callable } from "./types.ts";

export const CALLABLE_KINDS = [
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function",
  "method_definition",
] as const;

const CALLABLE = new Set<string>(CALLABLE_KINDS);

const DECISION_KINDS = [
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_case",
  "catch_clause",
  "ternary_expression",
  "binary_expression",
];
const LOGICAL = new Set(["&&", "||", "??"]);

const BINDING_WRAPPERS = new Set([
  "parenthesized_expression",
  "as_expression",
  "satisfies_expression",
  "non_null_expression",
]);

export function mass(cc: number, sloc: number): number {
  return cc * Math.sqrt(sloc);
}

export function extractCallables(src: Source): Callable[] {
  const root = src.root.root();
  const nodes = root.findAll({ rule: { any: CALLABLE_KINDS.map((kind) => ({ kind })) } });
  // complexityByCallable needs start order, with an outer callable before an inner one that starts at the same index.
  nodes.sort(
    (a, b) =>
      a.range().start.index - b.range().start.index || b.range().end.index - a.range().end.index,
  );
  const cc = complexityByCallable(root, nodes);
  const names = new CallableNames();
  const lines = src.text.split("\n");
  return nodes.map((node, index) => {
    const { start, end } = node.range();
    const startLine = start.line + 1;
    const endLine = end.line + 1;
    const sloc = codeLinesIn(src.code, startLine, endLine);
    const complexity = cc[index] ?? 1;
    const key = names.keyFor(node);
    const body: string[] = [];
    for (let line = startLine + 1; line <= endLine; line++) {
      if (src.code.has(line)) body.push((lines[line - 1] ?? "").trim());
    }
    return {
      key,
      name: key,
      kind: String(node.kind()),
      startLine,
      endLine,
      cc: complexity,
      sloc,
      mass: mass(complexity, sloc),
      body,
    };
  });
}

function complexityByCallable(root: SgNode, callables: SgNode[]): number[] {
  const sweep = new SpanSweep(
    callables.map((node) => ({ start: node.range().start.index, end: node.range().end.index })),
  );
  const cc = callables.map(() => 1);
  for (const at of decisionOffsets(root)) {
    // Only the innermost callable gets the point, so a nested function's branches never count toward the outer one.
    const owner = sweep.ownerOf(at);
    if (owner !== undefined) cc[owner] = (cc[owner] ?? 1) + 1;
  }
  return cc;
}

function decisionOffsets(root: SgNode): number[] {
  return root
    .findAll({ rule: { any: DECISION_KINDS.map((kind) => ({ kind })) } })
    .filter(isDecision)
    .map((node) => node.range().start.index)
    .sort((a, b) => a - b);
}

function isDecision(node: SgNode): boolean {
  return (
    node.kind() !== "binary_expression" || LOGICAL.has(fieldNode(node, "operator")?.text() ?? "")
  );
}

type Span = { start: number; end: number };

class SpanSweep {
  private readonly spans: Span[];
  private readonly open: number[] = [];
  private next = 0;

  constructor(spans: Span[]) {
    this.spans = spans;
  }

  ownerOf(at: number): number | undefined {
    while (this.next < this.spans.length && this.startOf(this.next) <= at) this.enter(this.next++);
    this.closeUpTo(at);
    return this.open.at(-1);
  }

  private enter(index: number): void {
    this.closeUpTo(this.startOf(index));
    this.open.push(index);
  }

  private closeUpTo(at: number): void {
    while (this.open.length > 0 && this.endOf(this.open.at(-1) ?? 0) <= at) this.open.pop();
  }

  private startOf(index: number): number {
    return this.spans[index]?.start ?? 0;
  }

  private endOf(index: number): number {
    return this.spans[index]?.end ?? 0;
  }
}

class CallableNames {
  private keys = new Map<number, string>();
  private used = new Map<string, number>();

  keyFor(node: SgNode): string {
    const prefix = this.prefixFor(node);
    const local = localName(node) ?? anonymousName(node);
    const base = prefix ? `${prefix}.${local}` : local;
    const seen = (this.used.get(base) ?? 0) + 1;
    this.used.set(base, seen);
    const key = seen === 1 ? base : `${base}#${seen}`;
    this.keys.set(node.id(), key);
    return key;
  }

  private prefixFor(node: SgNode): string {
    const parts: string[] = [];
    for (const ancestor of node.ancestors()) {
      if (CALLABLE.has(String(ancestor.kind()))) {
        parts.unshift(this.keys.get(ancestor.id()) ?? "?");
        break;
      }
      const name = containerName(ancestor);
      if (name) parts.unshift(name);
    }
    return parts.join(".");
  }
}

function containerName(node: SgNode): string | null {
  switch (node.kind()) {
    case "class_declaration":
    case "abstract_class_declaration":
    case "internal_module":
      return fieldText(node, "name");
    case "class":
      return fieldText(node, "name") ?? bindingName(node) ?? "<class>";
    case "object":
      return bindingName(node);
    default:
      return null;
  }
}

function localName(node: SgNode): string | null {
  const kind = node.kind();
  if (kind === "method_definition") {
    const accessor = node
      .children()
      .find((child) => child.kind() === "get" || child.kind() === "set");
    const name = fieldText(node, "name") ?? "?";
    return accessor ? `${accessor.kind()} ${name}` : name;
  }
  if (kind === "function_declaration" || kind === "generator_function_declaration")
    return fieldText(node, "name") ?? "default";
  return bindingName(node) ?? fieldText(node, "name");
}

function bindingName(node: SgNode): string | null {
  let child = node;
  let parent = node.parent();
  while (parent && BINDING_WRAPPERS.has(String(parent.kind()))) {
    child = parent;
    parent = parent.parent();
  }
  if (!parent) return null;
  switch (parent.kind()) {
    case "variable_declarator":
      return fieldText(parent, "name");
    case "pair":
      return unquote(fieldText(parent, "key"));
    case "public_field_definition":
      return fieldText(parent, "name");
    case "export_statement":
      return "default";
    case "assignment_expression":
      return fieldNode(parent, "right")?.id() === child.id() ? fieldText(parent, "left") : null;
    default:
      return null;
  }
}

function anonymousName(node: SgNode): string {
  const args = node.parent();
  const call = args?.kind() === "arguments" ? args.parent() : null;
  if (!call || call.kind() !== "call_expression") return "<anon>";
  const callee = (fieldText(call, "function") ?? "?").split(".").at(-1) ?? "?";
  const first = args?.namedChildren()[0];
  if (
    first &&
    first.id() !== node.id() &&
    (first.kind() === "string" || first.kind() === "template_string")
  ) {
    return `<${callee}(${shorten(first.text())}) cb>`;
  }
  return `<${callee} cb>`;
}

function fieldNode(node: SgNode, name: string): SgNode | null {
  // The typed-kinds generics do not accept a field name known only at runtime.
  return node.field(name as never) as unknown as SgNode | null;
}

function fieldText(node: SgNode, name: string): string | null {
  return fieldNode(node, name)?.text() ?? null;
}

function unquote(text: string | null): string | null {
  return text?.replace(/^(["'`])(.*)\1$/, "$2") ?? null;
}

function shorten(literal: string): string {
  const quote = literal[0] ?? '"';
  const inner = literal.slice(1, -1);
  return inner.length <= 32 ? literal : `${quote}${inner.slice(0, 32)}…${quote}`;
}
