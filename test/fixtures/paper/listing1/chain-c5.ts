export type Rule = { id: string; kind: string; text: string };
export type Match = { rule: string; line: number; column: number };

export function parseRules(json: string): Rule[] {
  return JSON.parse(json) as Rule[];
}

export function formatMatch(match: Match): string {
  return `${match.rule} ${match.line}:${match.column}`;
}

export function findMatches(source: string, rules: Rule[]): Match[] {
  const matches: Match[] = [];
  const lines = source.split("\n");
  for (const rule of rules) {
    for (let index = 0; index < lines.length; index++) {
      const text = lines[index] ?? "";
      const line = index + 1;
      if (rule.kind === "exact") {
        const column = text.indexOf(rule.text);
        if (column >= 0) matches.push({ rule: rule.id, line, column });
      } else if (rule.kind === "regex") {
        const found = new RegExp(rule.text).exec(text);
        if (found) matches.push({ rule: rule.id, line, column: found.index });
      } else if (rule.kind === "prefix") {
        const column = text.length - text.trimStart().length;
        if (text.trimStart().startsWith(rule.text)) matches.push({ rule: rule.id, line, column });
      } else if (rule.kind === "suffix") {
        const column = text.trimEnd().length - rule.text.length;
        if (text.trimEnd().endsWith(rule.text)) matches.push({ rule: rule.id, line, column });
      } else if (rule.kind === "word") {
        const found = new RegExp(`\\b${rule.text}\\b`).exec(text);
        if (found) matches.push({ rule: rule.id, line, column: found.index });
      } else {
        throw new Error(`unknown rule kind: ${rule.kind}`);
      }
    }
  }
  return matches;
}
