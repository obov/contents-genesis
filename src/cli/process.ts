import { spawnSync } from "node:child_process";

/** Run bun (the current executable) synchronously, inheriting stdio. */
export function runBun(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    stdio: ["inherit", process.env.CG_QUIET ? "ignore" : "inherit", "inherit"],
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`bun ${args.join(" ")} failed with exit ${result.status}`);
}
