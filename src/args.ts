export type Args = {
  help: boolean;
  json: boolean;
  legend: boolean;
  repo: boolean;
  ccThreshold: number;
  excludes: string[];
  base: string | null;
  head: string;
};

export class UsageError extends Error {}

const SWITCHES = new Map<string, Partial<Args>>([
  ["-h", { help: true }],
  ["--help", { help: true }],
  ["--json", { json: true }],
  ["--no-legend", { legend: false }],
  ["--no-repo", { repo: false }],
]);

const VALUE_FLAGS = new Set(["--cc-threshold", "--exclude"]);

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    help: false,
    json: false,
    legend: true,
    repo: true,
    ccThreshold: 10,
    excludes: [],
    base: null,
    head: "HEAD",
  };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const { flag, inline } = splitInline(arg);
    const switched = SWITCHES.get(flag);
    if (switched) {
      Object.assign(args, switched);
    } else if (VALUE_FLAGS.has(flag)) {
      const value = inline ?? argv[++index];
      applyValue(args, flag, requireValue(flag, value));
    } else {
      if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option ${arg}`);
      positional.push(arg);
    }
  }
  assignRefs(args, positional);
  return args;
}

function assignRefs(args: Args, positional: string[]): void {
  if (positional.length > 2)
    throw new UsageError(`expected at most two refs, got ${positional.length}`);
  args.base = positional[0] ?? null;
  args.head = positional[1] ?? "HEAD";
}

function splitInline(arg: string): { flag: string; inline: string | undefined } {
  const at = arg.indexOf("=");
  if (!arg.startsWith("--") || at === -1) return { flag: arg, inline: undefined };
  return { flag: arg.slice(0, at), inline: arg.slice(at + 1) };
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value === "") throw new UsageError(`${flag} needs a value`);
  return value;
}

function applyValue(args: Args, flag: string, value: string): void {
  if (flag === "--exclude") args.excludes.push(value);
  else args.ccThreshold = parseThreshold(value);
}

function parseThreshold(raw: string): number {
  const threshold = Number(raw);
  if (!Number.isInteger(threshold) || threshold < 1)
    throw new UsageError(`--cc-threshold needs a positive integer, got ${raw}`);
  return threshold;
}
