export type Callable = {
	key: string;
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
	cc: number;
	sloc: number;
	mass: number;
	body: string[];
};

export type Metrics = { cc: number; sloc: number; mass: number };

export type ErosionChangeKind = "crossed" | "born" | "worse" | "improved";

export type ErosionChange = {
	kind: ErosionChangeKind;
	file: string;
	name: string;
	line: number;
	before: Metrics | null;
	after: Metrics;
	renamedFrom?: string;
};

export type LineRange = { file: string; start: number; end: number };

export type RuleHit = { rule: string; file: string; start: number; end: number };

export type Clone = { lines: number; a: LineRange; b: LineRange };

export type RuleSummary = { id: string; label: string; lines: number };

export type PrVerbosity = {
	addedLines: number;
	addedSloc: number;
	flaggedLines: number;
	cloneLines: number;
	unionLines: number;
	ratio: number;
	rules: RuleSummary[];
	hits: RuleHit[];
	clones: Clone[];
};

export type SnapshotMetrics = {
	files: number;
	callables: number;
	sloc: number;
	erosion: number;
	verbosity: number;
	flaggedLines: number;
	cloneLines: number;
};

export type Report = {
	base: { ref: string; sha: string };
	head: { ref: string; sha: string | null };
	ccThreshold: number;
	files: string[];
	erosion: ErosionChange[];
	touched: { callables: number; maxCc: number; maxCcName: string | null };
	verbosity: PrVerbosity;
	repo: { base: SnapshotMetrics; head: SnapshotMetrics } | null;
};
