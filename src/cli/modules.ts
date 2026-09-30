import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { json, readJson } from "../../core/files.ts";
import type { Manifest } from "../../core/model.ts";
import {
  BUILTIN_PREFIX,
  builtinDir,
  builtinModules,
  isLocalSpec,
} from "../../core/resolve.ts";
import {
  PACKAGE_VERSION,
  builtinManifest,
  builtinSpec,
  dependentsOf,
  loadManifests,
  missingBuiltinDependencies,
  readProject,
  updateProject,
} from "./project.ts";
import { runBun } from "./process.ts";

const ID = /^[a-z][a-z0-9_]*$/;

export function listModules(root: string) {
  const config = readProject(root),
    installed = loadManifests(root, config.modules);
  const ids = new Set(installed.map((m) => m.manifest.id));
  return {
    installed: installed.map((m) => ({
      id: m.manifest.id,
      version: m.manifest.version,
      kind: m.kind,
      spec: m.spec,
      requires: Object.keys(m.manifest.requires_modules ?? {}),
      required_by: dependentsOf(installed, m.manifest.id),
    })),
    available_builtin: builtinModules().filter((name) => !ids.has(name)),
  };
}

function packageNameAfterInstall(root: string, spec: string): string {
  const before =
    readJson<{ dependencies?: Record<string, string> }>(
      resolve(root, "package.json"),
    ).dependencies ?? {};
  // Already a dependency and installed: register without reinstalling.
  if (
    spec in before &&
    existsSync(resolve(root, "node_modules", spec, "module.json"))
  )
    return spec;
  runBun(["add", spec], root);
  const after =
    readJson<{ dependencies?: Record<string, string> }>(
      resolve(root, "package.json"),
    ).dependencies ?? {};
  const added = Object.keys(after).filter((name) => !(name in before));
  if (added.length === 1) return added[0]!;
  // Already installed: match by the dependency value (e.g. github:owner/repo).
  const match = Object.entries(after).find(
    ([name, value]) => value === spec || name === spec,
  );
  if (!match) throw new Error(`Could not determine package name for ${spec}`);
  return match[0];
}

/**
 * Add a module by builtin name, "@cg/<name>", local path, or package spec
 * (npm name, github:owner/repo, file:path). Missing builtin dependencies are
 * added automatically.
 */
export function addModule(root: string, input: string) {
  let spec: string;
  if (input.startsWith(BUILTIN_PREFIX)) spec = input;
  else if (ID.test(input) && builtinModules().includes(input))
    spec = builtinSpec(input);
  else if (isLocalSpec(input))
    spec =
      input.startsWith(".") || input.startsWith("/") ? input : "./" + input;
  else {
    spec = packageNameAfterInstall(root, input);
    try {
      return addResolved(root, spec);
    } catch (error) {
      runBun(["remove", spec], root);
      throw error;
    }
  }
  return addResolved(root, spec);
}

function addResolved(root: string, spec: string) {
  const config = readProject(root);

  const installed = loadManifests(root, config.modules),
    ids = new Set(installed.map((m) => m.manifest.id));
  if (config.modules.includes(spec)) return { added: [], already: spec };
  const [candidate] = loadManifests(root, [spec]);
  if (ids.has(candidate!.manifest.id))
    throw new Error(
      `Module id ${candidate!.manifest.id} already installed from another source; remove it first`,
    );
  const deps = missingBuiltinDependencies(candidate!.manifest, ids).map(
    builtinSpec,
  );
  updateProject(root, (c) => {
    c.modules.push(...deps, spec);
  });
  return { added: [...deps, spec] };
}

export function removeModule(root: string, id: string, cascade: boolean) {
  const config = readProject(root),
    installed = loadManifests(root, config.modules),
    target = installed.find((m) => m.manifest.id === id);
  if (!target) throw new Error(`Module not installed: ${id}`);
  const dependents = dependentsOf(installed, id);
  if (dependents.length && !cascade)
    throw new Error(
      `${id} is required by ${dependents.join(", ")}; use --cascade to remove them too`,
    );
  const removeIds = new Set([id, ...dependents]),
    removed = installed.filter((m) => removeIds.has(m.manifest.id));
  updateProject(root, (c) => {
    c.modules = c.modules.filter(
      (spec) => !removed.some((m) => m.spec === spec),
    );
  });
  const packages = removed
    .filter((m) => m.kind === "package")
    .map((m) => m.spec);
  if (packages.length) runBun(["remove", ...packages], root);
  return {
    removed: removed.map((m) => m.spec),
    kept_files: removed.filter((m) => m.kind === "local").map((m) => m.spec),
    note: "Workspace records of removed types are kept; re-adding the module restores validation.",
  };
}

/** Copy a builtin module into ./modules/<id> for local customization. */
export function ejectModule(root: string, id: string) {
  const spec = builtinSpec(id),
    config = readProject(root);
  if (!config.modules.includes(spec))
    throw new Error(`Builtin module not installed: ${spec}`);
  const local = "./modules/" + id,
    target = resolve(root, local);
  if (existsSync(target)) throw new Error(`Already exists: ${local}`);
  cpSync(builtinDir(id), target, { recursive: true });
  writeFileSync(
    resolve(target, "EJECTED.json"),
    json({
      from: spec,
      contents_genesis_version: PACKAGE_VERSION,
      module_version: builtinManifest(id).version,
      ejected_at: new Date().toISOString(),
    }),
  );
  updateProject(root, (c) => {
    c.modules = c.modules.map((s) => (s === spec ? local : s));
  });
  return { ejected: spec, to: local };
}

/** Scaffold a new local module with one example type. */
export function newModule(root: string, id: string) {
  if (!ID.test(id)) throw new Error("Module id must match ^[a-z][a-z0-9_]*$");
  const local = "./modules/" + id,
    dir = resolve(root, local);
  if (existsSync(dir)) throw new Error(`Already exists: ${local}`);
  if (builtinModules().includes(id))
    throw new Error(
      `${id} is a builtin module name; use cg module eject ${id}`,
    );
  mkdirSync(resolve(dir, "schemas"), { recursive: true });
  const manifest: Manifest = {
    manifest_version: "1.0.0",
    id,
    version: "0.1.0",
    requires_core: "1.x",
    requires_modules: {},
    types: [
      { name: id + ".item", version: "1.0.0", schema: "schemas/item.v1.json" },
    ],
    relations: [],
  };
  writeFileSync(resolve(dir, "module.json"), json(manifest));
  writeFileSync(
    resolve(dir, "schemas/item.v1.json"),
    json({
      type: "object",
      required: ["summary"],
      properties: { summary: { type: "string", minLength: 1 } },
    }),
  );
  writeFileSync(
    resolve(dir, "README.md"),
    readFileSync(
      resolve(import.meta.dir, "../../templates/module/README.md"),
      "utf8",
    ).replaceAll("{{id}}", id),
  );
  updateProject(root, (c) => {
    c.modules.push(local);
  });
  return { created: local };
}
