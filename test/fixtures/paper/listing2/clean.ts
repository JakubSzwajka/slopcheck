type Rule = { id: string; languages: string[] };
type SourceFile = { path: string; language: string; text: string };
type Match = { rule: string; path: string; line: number };

declare function findMatches(file: SourceFile, rules: Rule[]): Match[];
declare function dedupe(matches: Match[]): Match[];

export function collectMatches(files: SourceFile[], rules: Rule[]): Match[] {
  const matchList: Match[] = [];
  for (const file of files) {
    const applicable = rules.filter((rule) => rule.languages.includes(file.language));
    matchList.push(...findMatches(file, applicable));
  }
  return dedupe(matchList);
}
