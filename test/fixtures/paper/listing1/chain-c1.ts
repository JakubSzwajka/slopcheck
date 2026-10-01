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
      } else {
        throw new Error(`unknown rule kind: ${rule.kind}`);
      }
    }
  }
  return matches;
}
