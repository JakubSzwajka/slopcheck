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
	/** Short name for the report summary. */
	label: string;
	/** `match` flags every line of the match, `first` only its first line (for rules that wrap a block). */
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
	if (typeof raw.id !== "string" || typeof raw.message !== "string" || typeof raw.rule !== "object" || raw.rule === null) {
		throw new Error(`rule file ${file} needs id, message and rule`);
	}
	const config = { rule: raw.rule, ...(raw.constraints ? { constraints: raw.constraints } : {}), ...(raw.utils ? { utils: raw.utils } : {}) } as NapiConfig;
	const label = typeof raw.metadata?.label === "string" ? raw.metadata.label : raw.id;
	const lines = raw.metadata?.lines === "first" ? "first" : "match";
	return { id: raw.id, message: raw.message, label, lines, config };
}

/**
 * One tree walk per file for all rules: a combined `any` finds candidate nodes,
 * then each candidate is checked against every rule to name the hits. The walk,
 * not the matching, dominates the cost, so this is several times faster than
 * one findAll per rule.
 */
export function runRules(src: Source, rules: Rule[]): RuleHit[] {
	if (rules.length === 0) return [];
	const root = src.root.root();
	const hits: RuleHit[] = [];
	const seen = new Set<string>();
	for (const node of root.findAll(combined(rules))) {
		const { start, end } = node.range();
		for (const rule of rules) {
			const id = `${rule.id}@${start.index}-${end.index}`;
			if (seen.has(id) || !node.matches(rule.config)) continue;
			seen.add(id);
			hits.push({ rule: rule.id, file: src.path, start: start.line + 1, end: rule.lines === "first" ? start.line + 1 : end.line + 1 });
		}
	}
	return hits;
}

const combinedCache = new WeakMap<Rule[], NapiConfig>();

/** All rules as one matcher. Each rule's utils get a prefix so two rules may reuse a util name. */
function combined(rules: Rule[]): NapiConfig {
	const cached = combinedCache.get(rules);
	if (cached) return cached;
	const utils: Record<string, unknown> = {};
	const any = rules.map((rule) => {
		const prefix = `${rule.id}__`;
		for (const [name, util] of Object.entries(rule.config.utils ?? {})) utils[prefix + name] = prefixMatches(util, prefix);
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
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "matches" && typeof item === "string" ? prefix + item : prefixMatches(item, prefix)]));
}

/** Code lines a hit covers. */
export function hitLines(hit: RuleHit, code: Set<number>): number[] {
	const lines: number[] = [];
	for (let line = hit.start; line <= hit.end; line++) if (code.has(line)) lines.push(line);
	return lines;
}
