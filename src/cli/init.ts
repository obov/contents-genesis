import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve, sep } from "node:path";
import { Catalog } from "../../core/catalog.ts";
import { json } from "../../core/files.ts";
import type { ProjectConfig } from "../../core/model.ts";
import { PACKAGE_ROOT, builtinModules } from "../../core/resolve.ts";
import { PACKAGE_VERSION, builtinManifest, builtinSpec } from "./project.ts";
import { runBun } from "./process.ts";
import { availableSkills, linkSkills } from "./skills.ts";

export type InitOptions = {
  id?: string;
  modules?: string[];
  skills?: string[];
  renderer: boolean;
  install: boolean;
  /** Dependency spec written to package.json for contents-genesis. */
  source?: string;
};

const TEMPLATES = resolve(PACKAGE_ROOT, "templates");

function render(from: string, to: string, id: string) {
  writeFileSync(to, readFileSync(from, "utf8").replaceAll("{{id}}", id));
}

function copyTemplate(from: string, to: string, id: string) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = resolve(from, entry),
      dst = resolve(to, entry);
    if (statSync(src).isDirectory()) copyTemplate(src, dst, id);
    else render(src, dst, id);
  }
}

/** Installed from a registry → semver range; from a checkout → file link. */
function defaultSource() {
  return PACKAGE_ROOT.split(sep).includes("node_modules")
    ? "^" + PACKAGE_VERSION
    : "file:" + PACKAGE_ROOT;
}

function withDependencies(names: string[]) {
  const out = new Set<string>();
  const visit = (name: string) => {
    if (out.has(name)) return;
    if (!builtinModules().includes(name))
      throw new Error(`Unknown builtin module: ${name}`);
    for (const dep of Object.keys(builtinManifest(name).requires_modules ?? {}))
      visit(dep);
    out.add(name);
  };
  names.forEach(visit);
  return [...out];
}

/** Builtin modules added only on request (cg module add / init --modules). */
const OPT_IN_MODULES = new Set(["adsense"]);

export function initProject(dir: string, options: InitOptions) {
  const root = resolve(dir),
    id =
      options.id ??
      basename(root)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");
  if (existsSync(resolve(root, "project.json")))
    throw new Error(`project.json already exists in ${root}`);
  mkdirSync(root, { recursive: true });

  const modules = withDependencies(
    options.modules ?? builtinModules().filter((m) => !OPT_IN_MODULES.has(m)),
  ).map(
    builtinSpec,
  );
  // cg-context is how agents learn the project layout; link it by default.
  const skills = [...new Set(["cg-context", ...(options.skills ?? [])])];
  for (const skill of skills)
    if (!availableSkills().includes(skill))
      throw new Error(`Unknown shared skill: ${skill}`);

  const config: ProjectConfig = {
    format_version: "1.0.0",
    id,
    modules,
    stores: {
      records: "workspace/records",
      objects: "workspace/objects",
      stores: "workspace/stores",
      indexes: "workspace/indexes",
      runs: "workspace/runs",
      work: "workspace/work",
    },
    skills,
    production: options.renderer
      ? {
          default_pipeline: "remotion",
          pipelines: {
            remotion: { use: "@cg/remotion", renderer: "renderer" },
          },
        }
      : { pipelines: {} },
  };
  writeFileSync(resolve(root, "project.json"), json(config));

  const packageFile = resolve(root, "package.json");
  if (!existsSync(packageFile))
    writeFileSync(
      packageFile,
      json({
        name: id,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          cg: "cg",
          check: "cg check",
          postinstall: "cg skill link",
        },
        dependencies: {
          "contents-genesis": options.source ?? defaultSource(),
        },
        devDependencies: { "@types/bun": "1.3.10", typescript: "5.9.3" },
      }),
    );

  for (const [template, target] of [
    ["AGENTS.md", "AGENTS.md"],
    ["CLAUDE.md", "CLAUDE.md"],
    ["gitignore", ".gitignore"],
    ["tsconfig.json", "tsconfig.json"],
  ] as const)
    if (!existsSync(resolve(root, target)))
      render(
        resolve(TEMPLATES, "project", template),
        resolve(root, target),
        id,
      );
  for (const folder of ["modules", ".agents/skills"]) {
    mkdirSync(resolve(root, folder), { recursive: true });
    writeFileSync(resolve(root, folder, ".gitkeep"), "");
  }
  if (options.renderer && !existsSync(resolve(root, "renderer")))
    copyTemplate(
      resolve(TEMPLATES, "renderer-remotion"),
      resolve(root, "renderer"),
      id,
    );

  const catalog = new Catalog(root);
  catalog.init();
  catalog.reindex();
  mkdirSync(resolve(catalog.path("stores"), "production/inputs"), {
    recursive: true,
  });

  // bun install triggers postinstall → cg skill link.
  if (options.install) runBun(["install"], root);
  else if (skills.length) linkSkills(root);

  return {
    project: root,
    id,
    modules,
    skills,
    renderer: options.renderer ? "renderer" : null,
    installed: options.install,
    next: [
      ...(options.install ? [] : ["bun install"]),
      ...(options.renderer ? ["cd renderer && npm ci"] : []),
      "bun cg module list",
    ],
  };
}
