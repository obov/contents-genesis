import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  Catalog,
  draft,
  hash,
  hashFile,
  readJson,
  relationDraft,
  type Locator,
  type Ref,
} from "contents-genesis/core";
import {
  RunJournal,
  parseResumeArgs,
  phaseAtLeast,
  type RuntimeRun,
} from "contents-genesis/runtime";
import { adoptInputs, adoptRunFiles, requireAdoptedInputs } from "./inputs.ts";
import {
  loadPipeline,
  pipelineConfig,
  type Operation,
  type OperationContext,
  type Pipeline,
  type PipelineContext,
  type ProductionItem,
} from "./pipeline.ts";

type PendingArtifact = {
  title: string;
  kind: string;
  locator: Locator;
  verification_only?: boolean;
  attributes?: Record<string, unknown>;
};

const USAGE = `production <operation> [ITEM] [args...] [--pipeline NAME] [--resume RUN]
production adopt ITEM [--from-run RUN]
production pipelines`;

function takeOption(args: string[], name: string) {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--"))
    throw new Error(name + " requires a value");
  args.splice(at, 2);
  return value;
}

export async function runProduction(argv: string[], projectRoot: string) {
  const catalog = new Catalog(projectRoot),
    stores = catalog.path("stores"),
    inputs = resolve(stores, "production/inputs"),
    exportsDir = resolve(stores, "production/exports"),
    { pipelines, fallback } = pipelineConfig(catalog.config),
    parsed = parseResumeArgs(argv),
    args = [...parsed.args],
    pipelineOption = takeOption(args, "--pipeline"),
    fromRun = takeOption(args, "--from-run"),
    [operation, ...positional] = args;

  const itemsFile = resolve(inputs, "projects.json"),
    items = existsSync(itemsFile)
      ? readJson<Record<string, ProductionItem>>(itemsFile)
      : {};

  const baseContext = (name: string, selector?: string): PipelineContext => {
    const options = pipelines[name];
    if (!options)
      throw new Error(
        `Unknown pipeline ${name}; configured: ${Object.keys(pipelines).join(", ")}`,
      );
    return {
      catalog,
      projectRoot,
      inputs,
      exports: exportsDir,
      name,
      options,
      ...(selector ? { selector, item: items[selector] } : {}),
    };
  };
  const pipelineNameFor = (selector?: string) =>
    pipelineOption ??
    (selector ? items[selector]?.pipeline : undefined) ??
    fallback;

  if (!operation || operation === "help") {
    console.log(USAGE);
    return;
  }

  if (operation === "pipelines") {
    const out: Record<string, unknown> = {};
    for (const [name, options] of Object.entries(pipelines)) {
      const { pipeline } = await loadPipeline(projectRoot, options);
      out[name] = {
        use: options.use,
        id: pipeline.id,
        version: pipeline.version,
        default: name === fallback,
        adoption: Boolean(pipeline.inputs),
        operations: Object.fromEntries(
          Object.entries(pipeline.operations).map(([op, def]) => [
            op,
            def.description ?? "",
          ]),
        ),
      };
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (operation === "adopt") {
    const selector = positional[0];
    if (!selector || !items[selector])
      throw new Error("Select a known item ID");
    if (parsed.resumeId) throw new Error("adopt does not use --resume");
    const name = pipelineNameFor(selector),
      ctx = baseContext(name, selector),
      { pipeline } = await loadPipeline(projectRoot, ctx.options);
    if (!pipeline.inputs)
      throw new Error(`Pipeline ${name} declares no inputs to adopt`);
    catalog.init();
    if (fromRun) {
      const source = readJson<RuntimeRun>(
        resolve(catalog.path("runs"), fromRun, "run.json"),
      );
      if (source.id !== fromRun)
        throw new Error("Run directory and ID differ: " + fromRun);
      if (source.project_id !== selector)
        throw new Error("Run belongs to a different item");
      if (!phaseAtLeast(source, "handler_succeeded"))
        throw new Error("Run did not finish external processing");
      const adoptable = source.adoptable ?? source.candidate_files;
      if (!Array.isArray(adoptable) || !adoptable.length)
        throw new Error("Run produced no adoptable files");
      if (typeof source.stage !== "string" || !existsSync(source.stage))
        throw new Error("Run stage is unavailable");
      adoptRunFiles(source.stage, inputs, adoptable as string[]);
    }
    const item = items[selector]!,
      adopted = await adoptInputs(
        catalog,
        inputs,
        selector,
        item,
        await pipeline.inputs({ ...ctx, selector, item }),
        fromRun,
      );
    catalog.reindex();
    console.log(
      JSON.stringify({
        project_id: selector,
        pipeline: name,
        project: adopted.project,
        script: adopted.script,
        changed: adopted.changed,
        adopted_from_run: fromRun ?? null,
      }),
    );
    return;
  }
  if (fromRun) throw new Error("--from-run is only valid with adopt");

  // Resolve pipeline + operation. Item operations take the item ID first.
  const guessSelector =
      positional[0] && items[positional[0]] ? positional[0] : undefined,
    name = pipelineNameFor(guessSelector),
    { pipeline, entry } = await loadPipeline(
      projectRoot,
      baseContext(name).options,
    ),
    op: Operation | undefined = pipeline.operations[operation];
  if (!op)
    throw new Error(
      `Pipeline ${name} has no operation ${operation}; available: ${Object.keys(pipeline.operations).join(", ")}\n${USAGE}`,
    );
  const needsItem = op.item ?? true,
    selector = needsItem ? positional[0] : undefined,
    rest = needsItem ? positional.slice(1) : positional;
  if (needsItem && (!selector || !items[selector]))
    throw new Error("Select a known item ID");
  const context = baseContext(name, selector),
    needsAdoption = op.adopted ?? (needsItem && Boolean(pipeline.inputs));

  const base: Record<string, unknown> = {
    project_id: selector ?? null,
    pipeline: name,
    pipeline_id: pipeline.id,
    pipeline_version: pipeline.version,
    parameters: op.parameters?.(rest) ?? rest,
    code_sha256: hash(
      hashFile(import.meta.path).sha256 + hashFile(entry).sha256,
    ),
    ...(pipeline.fingerprint?.(context) ?? {}),
  };
  const journal = RunJournal.open(
    catalog,
    "production." + operation,
    base,
    parsed.resumeId,
    Object.keys(base),
  );

  try {
    if (!phaseAtLeast(journal.state, "handler_succeeded"))
      await execute(
        journal,
        pipeline,
        op,
        operation,
        context,
        rest,
        needsAdoption,
      );

    const pending = (journal.state.pending_artifacts ??
      []) as PendingArtifact[];
    let outputs = journal.state.outputs as Ref[] | undefined;
    if (pending.length && !phaseAtLeast(journal.state, "committed"))
      outputs = commitArtifacts(catalog, journal, op, selector);
    if (pending.length && !phaseAtLeast(journal.state, "indexed")) {
      const index = catalog.reindex();
      journal.mark("indexed", {
        index_generation: index.generation,
        index_count: index.count,
      });
    }
    journal.succeed({ outputs: outputs ?? [] });
    console.log(
      JSON.stringify({
        run_id: journal.id,
        pipeline: name,
        resumed: Boolean(parsed.resumeId),
        outputs: outputs ?? [],
      }),
    );
  } catch (error) {
    journal.fail(error);
    throw error;
  }
}

async function execute(
  journal: RunJournal,
  pipeline: Pipeline,
  op: Operation,
  operation: string,
  context: PipelineContext,
  args: string[],
  needsAdoption: boolean,
) {
  const { catalog, selector, item } = context;
  let adopted: OperationContext["adopted"];
  if (needsAdoption) {
    if (!pipeline.inputs || !selector || !item)
      throw new Error("Operation requires adoption but pipeline has no inputs");
    adopted = await requireAdoptedInputs(
      catalog,
      context.inputs,
      selector,
      item,
      await pipeline.inputs({ ...context, selector, item }),
    );
  }

  const stage =
    typeof journal.state.stage === "string"
      ? journal.state.stage
      : resolve(catalog.path("work"), "production-" + journal.id);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  const env: Record<string, string> = {
    CG_EXPORTS_ROOT: context.exports,
    YT_EXPORTS_ROOT: context.exports,
    ...(adopted
      ? {
          CG_APPROVED_SCRIPT_TEXT: String(adopted.script.attributes.text),
          YT_APPROVED_SCRIPT_TEXT: String(adopted.script.attributes.text),
        }
      : {}),
  };
  const ctx: OperationContext = {
    ...context,
    operation,
    args,
    stage,
    runDir: journal.dir,
    adopted,
    env,
    async exec(argv, options = {}) {
      const child = Bun.spawn(argv, {
        cwd: options.cwd ?? stage,
        env: { ...process.env, ...env, ...options.env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      appendFileSync(resolve(journal.dir, "stdout.log"), stdout);
      appendFileSync(resolve(journal.dir, "stderr.log"), stderr);
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      if (code !== 0)
        throw new Error(
          `${argv[0]} failed with exit ${code}; see run ${journal.id}`,
        );
    },
  };

  if (op.stage !== false && pipeline.prepare) await pipeline.prepare(ctx);
  journal.update({
    stage,
    input_files: captureInputs(catalog, stage),
    ...(adopted
      ? {
          input_script: {
            id: adopted.script.id,
            revision: adopted.script.revision,
          },
          project_ref: {
            id: adopted.project.id,
            revision: adopted.project.revision,
          },
          input_pins: adopted.script.attributes.adopted_inputs,
        }
      : {}),
  });

  const result = (await op.run(ctx)) ?? {},
    pending: PendingArtifact[] = (result.artifacts ?? []).map((a) => ({
      title: a.title ?? `${selector ?? operation} ${a.kind}`,
      kind: a.kind,
      verification_only: a.verification_only ?? false,
      attributes: a.attributes,
      locator: catalog.putFile(
        a.file,
        a.media_type,
        a.role ?? "production_output",
      ),
    }));
  journal.mark("handler_succeeded", {
    exit_code: 0,
    pending_artifacts: pending,
    adoptable: result.adoptable ?? [],
    handler_succeeded_at: new Date().toISOString(),
  });
}

/** Content-address every staged input so the run is reproducible. */
function captureInputs(
  catalog: Catalog,
  directory: string,
  prefix = "",
): {
  path: string;
  locator: Locator;
}[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules")
    .flatMap((entry) => {
      const path = prefix + entry.name,
        full = resolve(directory, entry.name);
      if (entry.isDirectory()) return captureInputs(catalog, full, path + "/");
      if (!entry.isFile()) return [];
      return [
        {
          path,
          locator: catalog.putFile(
            full,
            "application/octet-stream",
            "render_input",
          ),
        },
      ];
    });
}

function commitArtifacts(
  catalog: Catalog,
  journal: RunJournal,
  op: Operation,
  selector: string | undefined,
): Ref[] {
  // Recovery: a crash after commit but before marking must not double-commit.
  const already = [...catalog.snapshot().latest.values()]
    .filter(
      (r) =>
        r.type === "production.artifact" && r.attributes.run_id === journal.id,
    )
    .map((r) => ({ id: r.id, revision: r.revision }));
  if (already.length) {
    journal.mark("committed", {
      outputs: already,
      commit_generation: catalog.snapshot().generation,
      commit_recovered: true,
    });
    return already;
  }

  const pending = journal.state.pending_artifacts as PendingArtifact[],
    script = journal.state.input_script as Ref | undefined,
    project = journal.state.project_ref as Ref | undefined;
  if (script && !catalog.get(script.id, script.revision))
    throw new Error("Pinned production script no longer resolves");
  if (project && !catalog.get(project.id, project.revision))
    throw new Error("Pinned production project no longer resolves");

  const artifacts = pending.map((item) =>
    draft(
      "production",
      "production.artifact",
      item.title,
      {
        ...(item.attributes ?? {}),
        artifact_kind: item.kind,
        pipeline: journal.state.pipeline,
        run_id: journal.id,
        project_id: selector ?? null,
        verification_only: item.verification_only ?? false,
      },
      { locators: [item.locator], type_version: "1.1.0" },
    ),
  );
  const mutations = artifacts.map((record) => ({
      expected_revision: 0,
      record,
    })),
    predicate = "production." + (op.relation ?? "rendered_from");
  for (const artifact of artifacts) {
    if (project)
      mutations.push({
        expected_revision: 0,
        record: relationDraft(
          "production",
          "production.belongs_to",
          { id: artifact.id },
          { id: project.id },
          {
            scope: {
              basis: "Artifact produced for the selected production project",
              run_id: journal.id,
            },
          },
        ),
      });
    if (script)
      mutations.push({
        expected_revision: 0,
        record: relationDraft(
          "production",
          predicate,
          { id: artifact.id, revision: 1 },
          script,
          {
            scope: {
              basis: `Produced by pipeline ${journal.state.pipeline} from the adopted inputs`,
              run_id: journal.id,
            },
            assertion_state: "observed",
          },
        ),
      });
  }
  const result = catalog.commit(mutations, "process:production"),
    outputs = artifacts.map((record) => ({ id: record.id, revision: 1 }));
  journal.mark("committed", { outputs, commit_generation: result.generation });
  return outputs;
}
