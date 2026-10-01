# slopcheck

A per-PR code quality report for TypeScript. It measures the two things the
SlopCodeBench paper tracks as code grows: structural erosion and verbosity. It
is advisory only. It never fails a build over a score.

## Based on

slopcheck is an independent TypeScript reimplementation of the two code-quality
metrics from this paper:

> Gabriel Orlanski, Devjeet Roy, Alexander Yun, Changho Shin, Alex Gu, Albert Ge,
> Dyah Adila, Frederic Sala, Aws Albarghouthi. "SlopCodeBench: Benchmarking How
> Coding Agents Degrade Over Long-Horizon Iterative Tasks." arXiv:2603.24755
> [cs.SE], 25 March 2026. CC BY 4.0.

- Paper: https://arxiv.org/abs/2603.24755
- HTML version: https://arxiv.org/html/2603.24755v1. The metrics are in section 2.3.
- Project site: https://www.scbench.ai
- Reference implementation, Python only, MIT: https://github.com/SprocketLab/slop-code-bench

This project is not affiliated with the paper's authors. They have not reviewed
or endorsed it.

The paper scores each callable f by mass(f) = CC(f) × √SLOC(f) (eq. 2).
Erosion is the share of mass held by callables with CC > 10 (eq. 3). The
threshold of 10 comes from Radon. Verbosity is |AST-grep flagged lines ∪ clone
lines| / LOC (eq. 4). slopcheck uses the same three formulas.

### What differs from the paper

1. The paper measures Python. slopcheck measures TypeScript and TSX.
2. The paper uses 137 AST-grep rules for Python. Those rules are not in the
   public repo tree. slopcheck ships its own 13 rules for TypeScript, listed
   under [Rules](#rules).
3. slopcheck finds clone lines with jscpd.
4. The paper measures a whole snapshot at each checkpoint. slopcheck reports
   the change between two commits. It matches functions across base and head
   and shows which ones crossed the threshold. It also prints whole-repo
   erosion and verbosity at base and head, unless you pass `--no-repo`.
5. CC counts `??`. A nested callable is its own callable, and its branches do
   not add to the outer function's CC.

Because of these changes, slopcheck scores are not comparable with the
numbers in the paper.

### A caveat from the paper

Appendix G of the paper tests the erosion threshold and what erosion predicts.
Erosion has near-zero correlation with the pass rate at the next checkpoint
(about −0.003). Its correlation with cost is weak (about 0.13). Read erosion as
a maintainability signal. It does not find bugs, and a high score does not
mean the code is broken.

## Requirements

Node 24 or newer, git, and macOS or Linux.

## Install

slopcheck is not published to npm. Clone it and put `bin/slopcheck` on your
PATH:

```sh
git clone https://github.com/JakubSzwajka/slopcheck.git
cd slopcheck
npm ci
mkdir -p ~/.local/bin
ln -s "$PWD/bin/slopcheck" ~/.local/bin/slopcheck
```

Any directory on your PATH works in place of `~/.local/bin`. Node runs the
TypeScript sources directly, so there is no build step. Check it with
`slopcheck --help`.

## Usage

```sh
slopcheck [base] [head] [--cc-threshold N] [--exclude GLOB]... [--no-repo] [--no-legend] [--json]
```

Run it anywhere inside a git repo.

- `base` defaults to the merge-base of HEAD with origin's default branch.
- `head` defaults to `HEAD`. `WORKTREE` means the uncommitted working tree,
  untracked files included.
- `--cc-threshold N` sets where a callable counts as eroded (default 10).
- `--exclude GLOB` skips paths, and you can repeat it: `--exclude '**/*.test.ts'`.
- `--no-repo` skips the whole-repo line. That line parses every file twice, so it is the slow part.
- `--no-legend` skips the "How to read this" key printed before a text report.
- `--json` prints the same data as JSON, with no key and no spinner.

Exit codes: 0 on success, 2 on a usage or runtime error.

## Output

A text report starts with a short key, printed before any work starts so you
can read it while the run works:

```
How to read this
  CC         1 + branches in one function: if, loops, case, catch, ?:, &&, ||, ??
             over 10 (--cc-threshold) is hard to change safely
  mass       CC × √lines, the complexity one function carries
  ✗          crossed over the threshold, or new and already over
  ▲          was over, and its mass grew
  ✓          dropped under the threshold
  flagged    added lines that match a waste rule (rules/*.yml)
  clone      added lines that copy code elsewhere in the repo
  Repo       erosion = share of mass in functions over the threshold
             verbosity = flagged or clone lines / all code lines
             both run 0 to 1, lower is better
```

The threshold in the key follows `--cc-threshold`. `--no-legend` hides it.

While it works, a spinner on stderr names the current phase and the seconds
so far, for example `⠋ scanning clones  6.3s`. The phases are: reading the
diff, parsing the changed files, extracting head files, scanning clones, and
with the repo line, extracting base files and the base and head snapshots. The
spinner shows only when stderr is a terminal and `--json` is off. It clears its
line before the report prints, and also on an error or Ctrl-C, and gives the
cursor back. Piped or redirected stderr gets no spinner bytes at all.

Then the report:

```
Slop check  base a1b2c3 → head d4e5f6   (5 TS files changed)
Erosion
  ✗ findMatches()    CC 9 → 14   mass 27 → 70  now over CC>10           src/find.ts:40
  ✗ loadAll()        CC 12       mass 61       new, born over CC>10     src/load.ts:8
  ▲ buildRegistry()  CC 12 → 15  mass +18      already over, got worse  src/registry.ts:12
  ✓ parseArgs()      CC 11 → 6                 now under                src/args.ts:3
Verbosity (added lines only)
  8 flagged lines  (single-use var ×5, else after return ×3)
      src/find.ts:52  single-use-return-var
  14 clone lines   src/a.ts:40-54 ≈ src/b.ts:12-26
  22 of 310 added code lines flagged (0.071)
Repo: erosion 0.412 → 0.415   verbosity 0.081 → 0.083
```

Rows are sorted by severity. Crossings come first, then new callables born over
the threshold, then callables that were over and got heavier, then callables
that dropped under. Within each group the biggest mass change comes first. When
nothing changes, the line says how many callables are new or changed and the
highest CC among them.

## Metrics

**Callables.** Function declarations, function expressions, arrow functions,
class and object methods, getters and setters, constructors, and generators. A
nested function is its own callable. The outer function's CC does not count the
branches inside a nested callable, the same as Radon and lizard.

**CC(f)** = 1 plus one for each: `if`, `for`, `for-in`, `for-of`, `while`,
`do-while`, each `case` of a switch (not `default`), `catch`, the ternary `?:`,
`&&`, `||` and `??`. An `else if` is a nested `if` and counts once. Optional
chaining, conditional types and `&&=`-style assignments do not count.

**SLOC(f)** = the lines in the callable's span that hold something other than
whitespace and comments. Comment spans come from the syntax tree, so a string
such as `"http://x"` is code.

**mass(f)** = CC(f) × √SLOC(f).

**Erosion** = the sum of mass over callables with CC > threshold, divided by the
sum of mass over all callables. The threshold is `--cc-threshold`, default 10.
Code outside any callable has no mass.

**Verbosity** = |flagged lines ∪ clone lines| / LOC, where LOC counts source
lines (no blanks, no comments), as in the paper's reference implementation.
Flagged lines come from the AST-grep rules below. Clone lines come from jscpd.
A line hit by several rules, or by a rule and a clone, counts once. Only code
lines count toward the top of the fraction.

## Per-PR behaviour

1. Changed files come from `git diff -M base head`, filtered to `.ts`, `.tsx`,
   `.mts` and `.cts`. It always skips `.d.ts` files, `*.generated.ts`, `*.gen.ts`,
   and anything under `node_modules`, `dist`, `build`, `coverage`, `generated` or
   `__generated__`. Deleted files are skipped.
2. For each changed file it parses the base version (`git show base:path`, using
   the old path for a rename) and the head version. It never checks anything
   out and never creates a worktree.
3. Callables are matched by file plus qualified name: `Class.method`,
   `outer.inner`, `obj.key`, `Class.get size`. An anonymous callable gets a
   fallback key from the call it is passed to, plus its first string argument
   when there is one: `<describe("parser") cb>.<it("reads a file") cb>`. A
   repeated key gets `#2`, `#3`. A callable left without a match is paired with
   a removed one of the same kind when their body lines are at least 60%
   similar (Dice coefficient). The report then shows `(was oldName)`.
4. Verbosity for the PR runs the rules on the head version of each changed file
   and keeps only hits on added lines, read from the `-U0` diff hunks. Clones:
   jscpd runs over the repo's tracked TypeScript files at head, and a clone is
   kept only when one of its ranges overlaps added code lines. The added side
   is shown first.
5. The repo line computes erosion and verbosity for the whole repo at base and
   at head. Each snapshot is `git archive <ref> -- '*.ts' '*.tsx' … | tar -x`
   into a temp dir, which is deleted at the end (and on Ctrl-C). Base and head
   each run on their own worker thread, side by side, and read their files
   there. That keeps the main thread free for the spinner.

For `WORKTREE`, the head side reads files from disk. jscpd then scans the
working tree and skips what `.gitignore` ignores.

## Rules

YAML rule files live in `rules/`, one rule per file, in ast-grep's rule format.
Each one runs on both `.ts` and `.tsx` files. `metadata.label` is the short name
in the summary. `metadata.lines: first` flags only the first line of a match,
for rules whose match wraps a block that stays. Otherwise every line of the
match is flagged.

| id | flags |
| --- | --- |
| `single-use-return-var` | `const x = expr; return x;` where `x` is used nowhere else (first line only) |
| `if-return-bool` | `if (c) return true; else return false;`, and `if (c) return true; return false;` unless it ends a chain of guards |
| `ternary-bool` | `c ? true : false`, `c ? false : true` |
| `compare-bool-literal` | `=== true`, `!== false` and friends, only when the other side is boolean by syntax (`!x`, a comparison, `instanceof`, `in`) |
| `identity-map` | `.map(x => x)` |
| `guarded-loop` | `if (xs.length) { for (const x of xs) … }` or `xs.forEach(…)` over the same array (first line only) |
| `catch-rethrow` | `catch (e) { throw e; }` |
| `async-await-wrapper` | `async (…) => await f(…)` |
| `else-after-return` | an `else` after an if branch that ends in `return`, not `else if` (first line only) |
| `return-await` | `return await` outside a try block in the same function |
| `double-negation-condition` | `!!x` as an `if`, `while`, `do` or ternary condition |
| `filter-length-check` | `xs.filter(f).length > 0`, `=== 0` and similar |
| `promise-resolve-in-async` | `return Promise.resolve(x)` directly inside an async function |

`compare-bool-literal` is narrow on purpose. `flag === true` on an optional or
`unknown` value is often deliberate in TypeScript, and a syntax-only rule
cannot tell.

Every rule has cases in `rule-tests/<id>-test.yml` (ast-grep's `valid` /
`invalid` format). `npm test` runs each case as TS and as TSX.

## Dependencies

- `@ast-grep/napi` 0.45.x parses TS and TSX and runs the rules. Its tree-sitter
  tree also drives CC and SLOC, so there is one parser.
- `jscpd` 5.x finds clones (exact clones, default 50 tokens and 5 lines).
- `yaml` reads the rule files. `@ast-grep/napi` takes rules as JS objects and
  does not read YAML itself.

## Develop

```sh
npm ci
npm run check   # tsc, biome, file size limits
npm test
```

## Citing the paper

If you use these metrics in your own work, cite the paper:

```bibtex
@misc{orlanski2026slopcodebench,
  title         = {SlopCodeBench: Benchmarking How Coding Agents Degrade Over Long-Horizon Iterative Tasks},
  author        = {Orlanski, Gabriel and Roy, Devjeet and Yun, Alexander and Shin, Changho and Gu, Alex and Ge, Albert and Adila, Dyah and Sala, Frederic and Albarghouthi, Aws},
  year          = {2026},
  eprint        = {2603.24755},
  archivePrefix = {arXiv},
  primaryClass  = {cs.SE},
  url           = {https://arxiv.org/abs/2603.24755}
}
```

## License

MIT. See [LICENSE](LICENSE).
