import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atomicJson } from "../../core/files.ts";

/** Claude Code SessionStart hook: inject `cg context --brief` into every session. */
export const HOOK_COMMAND =
  'cd "$CLAUDE_PROJECT_DIR" && [ -x node_modules/.bin/cg ] && node_modules/.bin/cg context --brief || true';

export function installHook(root: string) {
  const file = resolve(root, ".claude/settings.json");
  mkdirSync(resolve(root, ".claude"), { recursive: true });
  const settings = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, any>)
    : {};
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  const present = JSON.stringify(settings.hooks.SessionStart).includes(
    "cg context --brief",
  );
  if (!present)
    settings.hooks.SessionStart.push({
      hooks: [{ type: "command", command: HOOK_COMMAND }],
    });
  atomicJson(file, settings);
  return {
    hook: ".claude/settings.json SessionStart",
    installed: !present,
    already: present,
  };
}
