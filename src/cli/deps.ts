import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Direct dependency whose package.json spec pins a release but node_modules holds a local link. */
export type LinkedDependency = { name: string; spec: string; target: string };

// Specs that are meant to be local links (no mismatch).
const LOCAL_SPEC = /^(link|file|workspace|portal):/;

/**
 * Dependencies pinned to a version / git tag in package.json that are
 * installed as symlinks (e.g. left over from `bun link <pkg>` dev mode or a
 * spec change that `bun install` did not replace). The project then runs the
 * local checkout, not the pinned release.
 */
export function linkedDependencies(root: string): LinkedDependency[] {
  const file = resolve(root, "package.json");
  if (!existsSync(file)) return [];
  const pkg = JSON.parse(readFileSync(file, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const out: LinkedDependency[] = [];
  for (const [name, spec] of Object.entries({
    ...pkg.devDependencies,
    ...pkg.dependencies,
  })) {
    if (LOCAL_SPEC.test(spec)) continue;
    const dir = resolve(root, "node_modules", name);
    try {
      if (!lstatSync(dir).isSymbolicLink()) continue;
    } catch {
      continue; // not installed
    }
    let target = dir;
    try {
      target = realpathSync(dir);
    } catch {
      /* broken link: report the link itself */
    }
    out.push({ name, spec, target });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const linkedDependencyWarning = (d: LinkedDependency) =>
  `dependency ${d.name} is a local link (${d.target}) but package.json pins ${d.spec}; ` +
  `if dev mode (bun link) is over: rm node_modules/${d.name} && bun install`;
