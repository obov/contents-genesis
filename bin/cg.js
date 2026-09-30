#!/usr/bin/env node
// Node entry for `npx contents-genesis` / `cg`. The implementation runs on Bun
// (bun:sqlite, TypeScript sources), so this shim locates bun and delegates.
// Inside a project with its own contents-genesis install, that version wins.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const self = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function localInstall() {
  for (let at = process.cwd(); ; at = dirname(at)) {
    const candidate = resolve(at, "node_modules/contents-genesis");
    if (existsSync(resolve(candidate, "src/cli/main.ts")))
      return realpathSync(candidate);
    if (at === dirname(at)) return null;
  }
}

const local = localInstall(),
  root = local && local !== realpathSync(self) ? local : self,
  entry = resolve(root, "src/cli/main.ts"),
  bun = process.versions.bun ? process.execPath : process.env.BUN_BIN || "bun",
  result = spawnSync(bun, [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
  });

if (result.error?.code === "ENOENT") {
  console.error(
    "contents-genesis requires Bun (>=1.3).\n  Install: curl -fsSL https://bun.sh/install | bash\n  Then rerun, or use: bunx contents-genesis ...",
  );
  process.exit(127);
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
