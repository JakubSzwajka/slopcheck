import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temps = new Set<string>();

export function makeTemp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	temps.add(dir);
	return dir;
}

export function removeTemps(): void {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
	temps.clear();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		removeTemps();
		process.exit(130);
	});
}
