export type Rule = { id: string; kind: string; text: string };
export type Match = { rule: string; line: number; column: number };

export function parseRules(json: string): Rule[] {
  return JSON.parse(json) as Rule[];
}

export function formatMatch(match: Match): string {
  return `${match.rule} ${match.line}:${match.column}`;
}

type Finder = (text: string, rule: Rule) => number;

const finders: Record<string, Finder> = {
  exact: (text, rule) => text.indexOf(rule.text),
  regex: (text, rule) => new RegExp(rule.text).exec(text)?.index ?? -1,
  prefix: (text, rule) =>
    text.trimStart().startsWith(rule.text) ? text.length - text.trimStart().length : -1,
  suffix: (text, rule) =>
    text.trimEnd().endsWith(rule.text) ? text.trimEnd().length - rule.text.length : -1,
  word: (text, rule) => new RegExp(`\\b${rule.text}\\b`).exec(text)?.index ?? -1,
};

export function findMatches(source: string, rules: Rule[]): Match[] {
  const matches: Match[] = [];
  const lines = source.split("\n");
  for (const rule of rules) {
    const find = finders[rule.kind];
    if (!find) throw new Error(`unknown rule kind: ${rule.kind}`);
    for (let index = 0; index < lines.length; index++) {
      const column = find(lines[index] ?? "", rule);
      if (column >= 0) matches.push({ rule: rule.id, line: index + 1, column });
    }
  }
  return matches;
}
