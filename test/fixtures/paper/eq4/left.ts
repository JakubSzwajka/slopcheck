export function hasLongRun(values: number[], limit: number): boolean {
  let run = 0;
  let best = 0;
  for (const value of values) {
    run = value > limit ? run + 1 : 0;
    best = Math.max(best, run, Math.floor(value / limit));
  }
  const long = best >= limit ? true : false;
  return long;
}
