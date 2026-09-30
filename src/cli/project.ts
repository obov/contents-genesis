import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { atomicJson, readJson } from "../../core/files.ts";
import type { Manifest, ProjectConfig } from "../../core/model.ts";
import { Registry } from "../../core/registry.ts";
import {
  BUILTIN_PREFIX,
  PACKAGE_ROOT,
  builtinDir,
  builtinModules,
  resolveModule,
} from "../../core/resolve.ts";

export const PACKAGE_VERSION = readJson<{ version: string }>(
  resolve(PACKAGE_ROOT, "package.json"),
).version;

/** Nearest ancestor directory holding project.json. */
export function findProjectRoot(start: string): string {
  for (let at = resolve(start); ; at = dirname(at)) {
    if (existsSync(resolve(at, "project.json"))) return at;
    if (at === dirname(at))
      throw new Error(
        "project.json not found; run `cg init` or pass --project DIR",
      );
  }
}

export const readProject = (root: string) =>
  readJson<ProjectConfig>(resolve(root, "project.json"));

/**
 * Apply a change to project.json only if the resulting module set still loads.
 * Registry validation covers manifests, schemas, versions and dependencies.
 */
export function updateProject(
  root: string,
  change: (config: ProjectConfig) => void,
): ProjectConfig {
  const file = resolve(root, "project.json"),
    original = readFileSync(file, "utf8"),
    config = JSON.parse(original) as ProjectConfig;
  change(config);
  new Registry(root, config.modules);
  atomicJson(file, config);
  return config;
}

export type LoadedModule = {
  spec: string;
  manifest: Manifest;
  dir: string;
  kind: string;
};

/** Reads manifests without full registry validation (works on broken sets). */
export function loadManifests(root: string, specs: string[]): LoadedModule[] {
  return specs.map((spec) => {
    const source = resolveModule(root, spec);
    return {
      spec,
      manifest: readJson<Manifest>(resolve(source.dir, "module.json")),
      dir: source.dir,
      kind: source.kind,
    };
  });
}

export function builtinManifest(name: string): Manifest {
  return readJson<Manifest>(resolve(builtinDir(name), "module.json"));
}

/** Transitive builtin dependencies missing from the current module set. */
export function missingBuiltinDependencies(
  manifest: Manifest,
  installed: Set<string>,
): string[] {
  const builtins = new Set(builtinModules()),
    out: string[] = [],
    queue = Object.keys(manifest.requires_modules ?? {});
  while (queue.length) {
    const id = queue.shift()!;
    if (installed.has(id) || out.includes(id)) continue;
    if (!builtins.has(id))
      throw new Error(
        `${manifest.id} requires ${id}, which is not a builtin module; add it first`,
      );
    out.push(id);
    queue.push(...Object.keys(builtinManifest(id).requires_modules ?? {}));
  }
  return out;
}

/** Modules that (transitively) depend on `id`. */
export function dependentsOf(modules: LoadedModule[], id: string): string[] {
  const out = new Set<string>(),
    queue = [id];
  while (queue.length) {
    const target = queue.shift()!;
    for (const m of modules)
      if (m.manifest.requires_modules?.[target] && !out.has(m.manifest.id)) {
        out.add(m.manifest.id);
        queue.push(m.manifest.id);
      }
  }
  return [...out];
}

export const builtinSpec = (name: string) => BUILTIN_PREFIX + name;
