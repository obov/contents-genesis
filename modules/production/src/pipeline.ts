import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Catalog, ProjectConfig, RecordData } from "contents-genesis/core";

/**
 * Production pipelines turn one production item into artifacts.
 * The production module owns records, adoption, run journals and commits;
 * a pipeline owns only "how": Remotion video, TTS audio, blog HTML, ...
 */

/** One entry of workspace/stores/production/inputs/projects.json. */
export type ProductionItem = {
  /** Pipeline name from project.json production.pipelines. */
  pipeline?: string;
  /** Export/alias folder. Defaults to the item ID. */
  folder?: string;
  [key: string]: unknown;
};

/** project.json production.pipelines.<name> */
export type PipelineOptions = { use: string; [key: string]: unknown };

/** Adopted script text plus input files (relative to the inputs directory). */
export type InputSource = { text: string; files: string[] };

export type PipelineContext = {
  catalog: Catalog;
  projectRoot: string;
  /** workspace/stores/production/inputs */
  inputs: string;
  /** workspace/stores/production/exports */
  exports: string;
  /** Pipeline name in project.json. */
  name: string;
  options: PipelineOptions;
  selector?: string;
  item?: ProductionItem;
};

export type ExecOptions = { cwd?: string; env?: Record<string, string> };

export type OperationContext = PipelineContext & {
  operation: string;
  /** Positional arguments after the item ID (or after the operation). */
  args: string[];
  /** Fresh per-run working directory. */
  stage: string;
  /** Durable run directory (logs, outputs). */
  runDir: string;
  /** Adopted records when the operation requires adoption. */
  adopted?: { script: RecordData; project: RecordData };
  /** Base env passed to exec (exports root, approved script text). */
  env: Record<string, string>;
  /** Run a command; output is logged to the run directory. Throws on failure. */
  exec(argv: string[], options?: ExecOptions): Promise<void>;
};

export type ArtifactOutput = {
  file: string;
  /** Free-form kind: video, audio, thumbnail, captions, post, image, ... */
  kind: string;
  media_type: string;
  title?: string;
  role?: string;
  verification_only?: boolean;
  attributes?: Record<string, unknown>;
};

export type OperationResult = {
  artifacts?: ArtifactOutput[];
  /**
   * Stage-relative files that `production adopt ID --from-run RUN` may copy
   * back into the inputs directory (e.g. generated narration + timing).
   */
  adoptable?: string[];
};

export type Operation = {
  description?: string;
  /** Requires an item ID. Default true. */
  item?: boolean;
  /** Requires adopted inputs. Default: item && pipeline.inputs is defined. */
  adopted?: boolean;
  /** Call pipeline.prepare before run. Default true. */
  stage?: boolean;
  /** Relation from artifacts to the adopted script. Default rendered_from. */
  relation?: "rendered_from" | "generated_from";
  /** Values recorded as run identity. Default: args. */
  parameters?(args: string[]): unknown[];
  run(ctx: OperationContext): Promise<OperationResult | void>;
};

export type Pipeline = {
  id: string;
  version: string;
  /** What adoption pins for an item. Omit when the pipeline has no inputs. */
  inputs?(
    ctx: PipelineContext & { selector: string; item: ProductionItem },
  ): InputSource | Promise<InputSource>;
  /** Populate ctx.stage before an operation runs. */
  prepare?(ctx: OperationContext): void | Promise<void>;
  /** Extra run identity (tool versions, lockfile hashes, flags). */
  fingerprint?(ctx: PipelineContext): Record<string, unknown>;
  operations: Record<string, Operation>;
};

/** A pipeline module default-exports a Pipeline or a factory taking options. */
export type PipelineExport =
  | Pipeline
  | ((options: PipelineOptions) => Pipeline);

export const definePipeline = <T extends PipelineExport>(pipeline: T) =>
  pipeline;

export const BUILTIN_PIPELINE_PREFIX = "@cg/";
export const builtinPipelineDir = (id: string) =>
  resolve(import.meta.dir, "../pipelines", id);

/** Configured pipelines. Legacy `production.renderer` implies Remotion. */
export function pipelineConfig(config: ProjectConfig) {
  const production = config.production ?? {},
    pipelines: Record<string, PipelineOptions> = {
      ...(production.pipelines ?? {}),
    };
  if (!production.pipelines)
    pipelines.remotion = {
      use: "@cg/remotion",
      renderer: production.renderer ?? "renderer",
    };
  const fallback =
    production.default_pipeline ?? Object.keys(pipelines)[0] ?? "remotion";
  return { pipelines, fallback };
}

function entryOf(dir: string) {
  for (const name of ["index.ts", "index.mjs", "index.js"])
    if (existsSync(resolve(dir, name))) return resolve(dir, name);
  return undefined;
}

/** Resolve a pipeline spec: @cg/<id>, ./local/path, or installed package. */
export function resolvePipelineEntry(projectRoot: string, spec: string) {
  let entry: string | undefined;
  if (spec.startsWith(BUILTIN_PIPELINE_PREFIX))
    entry = entryOf(
      builtinPipelineDir(spec.slice(BUILTIN_PIPELINE_PREFIX.length)),
    );
  else if (spec.startsWith(".") || isAbsolute(spec)) {
    const path = resolve(projectRoot, spec);
    entry = /\.(ts|mjs|js)$/.test(path) ? path : entryOf(path);
  } else
    for (let at = projectRoot; ; at = dirname(at)) {
      entry = entryOf(resolve(at, "node_modules", spec));
      if (entry || at === dirname(at)) break;
    }
  if (!entry || !existsSync(entry))
    throw new Error(`Pipeline not found: ${spec}`);
  return entry;
}

export async function loadPipeline(
  projectRoot: string,
  options: PipelineOptions,
): Promise<{ pipeline: Pipeline; entry: string }> {
  if (typeof options?.use !== "string")
    throw new Error("Pipeline config requires a `use` spec");
  const entry = resolvePipelineEntry(projectRoot, options.use),
    loaded = (await import(pathToFileURL(entry).href)).default as
      | PipelineExport
      | undefined;
  if (!loaded)
    throw new Error(`Pipeline has no default export: ${options.use}`);
  const pipeline = typeof loaded === "function" ? loaded(options) : loaded;
  if (!pipeline?.id || !pipeline.version || !pipeline.operations)
    throw new Error(`Invalid pipeline: ${options.use}`);
  return { pipeline, entry };
}
