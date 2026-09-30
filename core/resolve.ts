import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/** Root of the installed contents-genesis package (holds builtin modules). */
export const PACKAGE_ROOT = resolve(import.meta.dir, "..");
export const BUILTIN_PREFIX = "@cg/";

export type ModuleKind = "builtin" | "local" | "package";
export type ModuleSource = { spec: string; kind: ModuleKind; dir: string };

export const builtinDir = (name: string) =>
  resolve(PACKAGE_ROOT, "modules", name);

export function builtinModules(): string[] {
  return readdirSync(resolve(PACKAGE_ROOT, "modules"), { withFileTypes: true })
    .filter(
      (e) => e.isDirectory() && existsSync(builtinDir(e.name) + "/module.json"),
    )
    .map((e) => e.name)
    .sort();
}

export const isLocalSpec = (spec: string) =>
  spec.startsWith("./") ||
  spec.startsWith("../") ||
  isAbsolute(spec) ||
  // Legacy form used by existing projects: "modules/<name>".
  (!spec.startsWith("@") && spec.includes("/") && !spec.includes(":"));

/**
 * Resolve a module spec from project.json to a directory containing module.json.
 * - "@cg/<name>"           builtin module shipped with contents-genesis
 * - "./modules/<name>"     local module inside the project
 * - "<npm-package-name>"   module installed in node_modules
 */
export function resolveModule(root: string, spec: string): ModuleSource {
  if (spec.startsWith(BUILTIN_PREFIX)) {
    const dir = builtinDir(spec.slice(BUILTIN_PREFIX.length));
    if (!existsSync(resolve(dir, "module.json")))
      throw new Error(`Unknown builtin module: ${spec}`);
    return { spec, kind: "builtin", dir };
  }
  if (isLocalSpec(spec)) {
    const dir = resolve(root, spec);
    if (!existsSync(resolve(dir, "module.json")))
      throw new Error(`Local module not found: ${spec}`);
    return { spec, kind: "local", dir };
  }
  for (let at = resolve(root); ; at = dirname(at)) {
    const dir = resolve(at, "node_modules", spec);
    if (existsSync(resolve(dir, "module.json")))
      return { spec, kind: "package", dir };
    if (at === dirname(at)) break;
  }
  throw new Error(
    `Module package not installed: ${spec} (run: cg module add ${spec})`,
  );
}
