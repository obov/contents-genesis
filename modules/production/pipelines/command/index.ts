import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { within } from "contents-genesis/core";
import {
  definePipeline,
  type OperationContext,
  type PipelineContext,
  type PipelineOptions,
  type ProductionItem,
} from "../../src/pipeline.ts";
import { mediaType } from "../../src/inputs.ts";

/**
 * Config-only pipeline: run any command, collect declared outputs.
 *
 *   "voice": {
 *     "use": "@cg/command",
 *     "inputs": { "text": "{item.script}", "files": ["{item.script}"] },
 *     "operations": {
 *       "generate": {
 *         "run": ["node", "tools/tts.mjs", "{inputs}/{item.script}", "{out}/narration.mp3"],
 *         "relation": "generated_from",
 *         "outputs": [{ "path": "{out}/narration.mp3", "kind": "audio" }]
 *       }
 *     }
 *   }
 *
 * Placeholders: {item} {project} {inputs} {exports} {stage} {out} {run} {item.<field>}
 * Relative output paths resolve against {out}. `cwd` defaults to the project root.
 * `adoptable` paths are relative to {stage} (copied back by adopt --from-run).
 */
type CommandOperation = {
  description?: string;
  run: string[];
  cwd?: string;
  env?: Record<string, string>;
  item?: boolean;
  adopted?: boolean;
  relation?: "rendered_from" | "generated_from";
  outputs?: {
    path: string;
    kind: string;
    media_type?: string;
    title?: string;
    verification_only?: boolean;
  }[];
  adoptable?: string[];
};
type CommandOptions = PipelineOptions & {
  operations?: Record<string, CommandOperation>;
  inputs?: { text: string; files?: string[] };
};

function expand(
  template: string,
  ctx: PipelineContext & Partial<OperationContext>,
) {
  const values: Record<string, string | undefined> = {
    item: ctx.selector,
    project: ctx.projectRoot,
    inputs: ctx.inputs,
    exports: ctx.exports,
    stage: ctx.stage,
    run: ctx.runDir,
    out: ctx.runDir && resolve(ctx.runDir, "out"),
  };
  return template.replace(
    /\{([a-z_]+)(?:\.([A-Za-z0-9_]+))?\}/g,
    (all, key, field) => {
      const value =
        key === "item" && field
          ? ctx.item?.[field]
          : field
            ? undefined
            : values[key];
      if (value === undefined || value === null)
        throw new Error(`Unresolved placeholder ${all}`);
      return String(value);
    },
  );
}

export default definePipeline((raw: PipelineOptions) => {
  const options = raw as CommandOptions,
    operations = options.operations ?? {};
  if (!Object.keys(operations).length)
    throw new Error("@cg/command pipeline needs `operations`");
  return {
    id: "command",
    version: "1.0.0",
    ...(options.inputs
      ? {
          inputs(
            ctx: PipelineContext & { selector: string; item: ProductionItem },
          ) {
            const spec = options.inputs!,
              textPath = expand(spec.text, ctx),
              files = (spec.files ?? [spec.text]).map((f) => expand(f, ctx));
            return {
              text: readFileSync(within(ctx.inputs, textPath), "utf8"),
              files,
            };
          },
        }
      : {}),
    operations: Object.fromEntries(
      Object.entries(operations).map(([name, op]) => [
        name,
        {
          description: op.description ?? op.run.join(" "),
          item: op.item,
          adopted: op.adopted,
          relation: op.relation,
          async run(ctx: OperationContext) {
            const out = resolve(ctx.runDir, "out");
            mkdirSync(out, { recursive: true });
            await ctx.exec(
              op.run.map((part) => expand(part, ctx)),
              {
                cwd: op.cwd
                  ? resolve(ctx.projectRoot, expand(op.cwd, ctx))
                  : ctx.projectRoot,
                env: Object.fromEntries(
                  Object.entries(op.env ?? {}).map(([k, v]) => [
                    k,
                    expand(v, ctx),
                  ]),
                ),
              },
            );
            const artifacts = (op.outputs ?? []).map((output) => {
              const file = resolve(out, expand(output.path, ctx));
              if (!existsSync(file))
                throw new Error("Declared output missing: " + output.path);
              return {
                file,
                kind: output.kind,
                media_type: output.media_type ?? mediaType(file),
                title: output.title ?? `${ctx.selector ?? name} ${output.kind}`,
                verification_only: output.verification_only,
                role: "command_output",
              };
            });
            return {
              artifacts,
              adoptable: (op.adoptable ?? []).map((p) => expand(p, ctx)),
            };
          },
        },
      ]),
    ),
  };
});
