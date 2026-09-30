import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PACKAGE_ROOT } from "../../core/resolve.ts";
import type { ProjectConfig } from "../../core/model.ts";
import { atomicJson } from "../../core/files.ts";
import { Catalog } from "../../core/catalog.ts";
import { readProject } from "./project.ts";
import { runBun } from "./process.ts";

const NAME = /^[a-z][a-z0-9_-]*$/;

type PipelineModule = typeof import("../../modules/production/src/pipeline.ts");

/** Load the pipeline contract from the installed production module (builtin or ejected). */
async function contract(root: string): Promise<PipelineModule> {
  const source = new Catalog(root).registry.sources.get("production");
  if (!source) throw new Error("production module not installed");
  return import(resolve(source.dir, "src/pipeline.ts"));
}

/** Legacy `production.renderer` becomes an explicit remotion pipeline. */
function materialize(config: ProjectConfig) {
  const production = (config.production ??= {});
  if (!production.pipelines) {
    production.pipelines = production.renderer
      ? { remotion: { use: "@cg/remotion", renderer: production.renderer } }
      : {};
    if (production.renderer) production.default_pipeline ??= "remotion";
  }
  delete production.renderer;
  return production as Required<
    Pick<NonNullable<ProjectConfig["production"]>, "pipelines">
  > &
    NonNullable<ProjectConfig["production"]>;
}

async function save(root: string, config: ProjectConfig, check?: string) {
  if (check) {
    const { loadPipeline } = await contract(root);
    await loadPipeline(root, config.production!.pipelines![check]!);
  }
  atomicJson(resolve(root, "project.json"), config);
}

export function listPipelines(root: string) {
  const source = new Catalog(root).registry.sources.get("production");
  if (!source) throw new Error("production module not installed");
  runBun([resolve(source.dir, "run.ts"), "pipelines"], root, {
    CG_PROJECT_ROOT: root,
  });
}

export async function addPipeline(root: string, name: string, spec: string) {
  if (!NAME.test(name))
    throw new Error("Pipeline name must match ^[a-z][a-z0-9_-]*$");
  const config = readProject(root),
    production = materialize(config);
  if (production.pipelines[name]) throw new Error(`Pipeline exists: ${name}`);
  let use = spec;
  if (
    !spec.startsWith("@cg/") &&
    !spec.startsWith(".") &&
    !spec.startsWith("/")
  ) {
    const deps = () =>
      Object.keys(
        JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
          .dependencies ?? {},
      );
    const before = deps();
    runBun(["add", spec], root);
    use = deps().find((n) => !before.includes(n)) ?? spec;
  }
  production.pipelines[name] = { use };
  production.default_pipeline ??= name;
  await save(root, config, name);
  return { added: name, use, default: production.default_pipeline === name };
}

export async function newPipeline(root: string, name: string) {
  if (!NAME.test(name))
    throw new Error("Pipeline name must match ^[a-z][a-z0-9_-]*$");
  const local = "./pipelines/" + name,
    dir = resolve(root, local);
  if (existsSync(dir)) throw new Error(`Already exists: ${local}`);
  const config = readProject(root),
    production = materialize(config);
  if (production.pipelines[name]) throw new Error(`Pipeline exists: ${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "index.ts"),
    readFileSync(
      resolve(PACKAGE_ROOT, "templates/pipeline/index.ts"),
      "utf8",
    ).replaceAll("{{id}}", name),
  );
  production.pipelines[name] = { use: local };
  production.default_pipeline ??= name;
  await save(root, config, name);
  return { created: local };
}

export function removePipeline(root: string, name: string) {
  const config = readProject(root),
    production = materialize(config);
  if (!production.pipelines[name])
    throw new Error(`Pipeline not configured: ${name}`);
  delete production.pipelines[name];
  if (production.default_pipeline === name)
    production.default_pipeline = Object.keys(production.pipelines)[0];
  if (!production.default_pipeline) delete production.default_pipeline;
  atomicJson(resolve(root, "project.json"), config);
  return { removed: name, default: production.default_pipeline ?? null };
}

export function defaultPipeline(root: string, name: string) {
  const config = readProject(root),
    production = materialize(config);
  if (!production.pipelines[name])
    throw new Error(`Pipeline not configured: ${name}`);
  production.default_pipeline = name;
  atomicJson(resolve(root, "project.json"), config);
  return { default: name };
}
