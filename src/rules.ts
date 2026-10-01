import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NapiConfig } from "@ast-grep/napi";
import { parse as parseYaml } from "yaml";
import type { Source } from "./source.ts";
import type { RuleHit } from "./types.ts";

export const RULES_DIR = fileURLToPath(new URL("../rules/", import.meta.url));

export type Rule = {
  id: string;
  message: string;
  label: string;
  lines: "match" | "first";
  config: NapiConfig;
};

type RuleFile = {
  id?: unknown;
  message?: unknown;
  rule?: unknown;
  constraints?: unknown;
  utils?: unknown;
  metadata?: { label?: unknown; lines?: unknown };
};

let cached: Rule[] | null = null;

export function loadRules(dir = RULES_DIR): Rule[] {
  if (dir === RULES_DIR && cached) return cached;
  const rules = readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => toRule(name, parseYaml(readFileSync(join(dir, name), "utf8")) as RuleFile));
  if (dir === RULES_DIR) cached = rules;
  return rules;
}

function toRule(file: string, raw: RuleFile): Rule {
  if (
    typeof raw.id !== "string" ||
    typeof raw.message !== "string" ||
    typeof raw.rule !== "object" ||
    raw.rule === null
  ) {
    throw new Error(`rule file ${file} needs id, message and rule`);
  }
  const config = {
    rule: raw.rule,
    ...(raw.constraints ? { constraints: raw.constraints } : {}),
    ...(raw.utils ? { utils: raw.utils } : {}),
  } as NapiConfig;
  const label = typeof raw.metadata?.label === "string" ? raw.metadata.label : raw.id;
  const lines = raw.metadata?.lines === "first" ? "first" : "match";
  return { id: raw.id, message: raw.message, label, lines, config };
}

export function runRules(src: Source, rules: Rule[]): RuleHit[] {
  if (rules.length === 0) return [];
  const root = src.root.root();
  const hits: RuleHit[] = [];
  const seen = new Set<string>();
  // One walk for all rules: the walk, not the matching, dominates, so this beats one findAll per rule.
  for (const node of root.findAll(combined(rules))) {
    const { start, end } = node.range();
    for (const rule of rules) {
      const id = `${rule.id}@${start.index}-${end.index}`;
      if (seen.has(id) || !node.matches(rule.config)) continue;
      seen.add(id);
      // "first" is for rules whose match wraps a whole block, so only its opening line counts.
      hits.push({
        rule: rule.id,
        file: src.path,
        start: start.line + 1,
        end: rule.lines === "first" ? start.line + 1 : end.line + 1,
      });
    }
  }
  return hits;
}

const combinedCache = new WeakMap<Rule[], NapiConfig>();

function combined(rules: Rule[]): NapiConfig {
  const cached = combinedCache.get(rules);
  if (cached) return cached;
  const utils: Record<string, unknown> = {};
  const any = rules.map((rule) => {
    // Prefixed util names let two rules reuse a util name.
    const prefix = `${rule.id}__`;
    for (const [name, util] of Object.entries(rule.config.utils ?? {}))
      utils[prefix + name] = prefixMatches(util, prefix);
    // Constraints are left out here: this only finds candidates, and matches() below applies the full rule.
    return prefixMatches(rule.config.rule, prefix);
  });
  const config = { rule: { any }, utils } as NapiConfig;
  combinedCache.set(rules, config);
  return config;
}

function prefixMatches(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item) => prefixMatches(item, prefix));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "matches" && typeof item === "string" ? prefix + item : prefixMatches(item, prefix),
    ]),
  );
}

export function hitLines(hit: RuleHit, code: Set<number>): number[] {
  const lines: number[] = [];
  for (let line = hit.start; line <= hit.end; line++) if (code.has(line)) lines.push(line);
  return lines;
}
