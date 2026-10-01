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
    const [flag, inline] =
      arg.startsWith("--") && arg.includes("=")
        ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
        : [arg, undefined];
    const value = () => {
      const next = inline ?? argv[++index];
      if (next === undefined || next === "") throw new UsageError(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--no-legend":
        args.legend = false;
        break;
      case "--no-repo":
        args.repo = false;
        break;
      case "--cc-threshold": {
        const raw = value();
        const threshold = Number(raw);
        if (!Number.isInteger(threshold) || threshold < 1)
          throw new UsageError(`--cc-threshold needs a positive integer, got ${raw}`);
        args.ccThreshold = threshold;
        break;
      }
      case "--exclude":
        args.excludes.push(value());
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option ${arg}`);
        positional.push(arg);
    }
  }
  if (positional.length > 2)
    throw new UsageError(`expected at most two refs, got ${positional.length}`);
  args.base = positional[0] ?? null;
  args.head = positional[1] ?? "HEAD";
  return args;
}
