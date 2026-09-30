import { cpSync, existsSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashFile, readJson } from "contents-genesis/core";
import {
  definePipeline,
  type OperationContext,
  type PipelineContext,
  type ProductionItem,
} from "../../src/pipeline.ts";

/**
 * Remotion video pipeline. Options (project.json production.pipelines.<name>):
 *   renderer: renderer directory relative to the project root (default "renderer")
 *
 * Item fields (projects.json):
 *   folder, composition, cover, script, cuesExport, timing,
 *   narration?: { voice, audioFile }, voiceScript? (default scripts/typecast-short.mjs)
 */
type RemotionItem = ProductionItem & {
  folder: string;
  composition: string;
  script: string;
  cuesExport: string;
  timing: string;
  narration?: { voice?: string; audioFile?: string };
  voiceScript?: string;
};

const rendererDir = (ctx: PipelineContext) =>
  resolve(ctx.projectRoot, String(ctx.options.renderer ?? "renderer"));

const asItem = (ctx: { item?: ProductionItem }) => ctx.item as RemotionItem;

const voiceFile = (item: RemotionItem) =>
  item.narration?.voice ?? item.timing.replace("-timing.json", "-voice.json");

async function scriptText(inputs: string, item: RemotionItem) {
  const module = await import(
    pathToFileURL(resolve(inputs, item.script)).href +
      "?adopt=" +
      Date.now().toString(36)
  );
  const cues = module[item.cuesExport];
  if (
    !Array.isArray(cues) ||
    cues.length === 0 ||
    cues.some((cue) => typeof cue?.text !== "string")
  )
    throw new Error("Project cue export is invalid: " + item.cuesExport);
  return cues.map((cue: { text: string }) => cue.text).join("\n");
}

function inputPaths(inputs: string, item: RemotionItem) {
  const timing = readJson<{ audioFile?: string }>(resolve(inputs, item.timing)),
    audioFile = timing.audioFile ?? item.narration?.audioFile;
  if (!audioFile) throw new Error("Timing does not declare an audio file");
  return [item.script, item.timing, voiceFile(item), "public/" + audioFile];
}

function binary(ctx: OperationContext, name: string) {
  return resolve(rendererDir(ctx), "node_modules/.bin", name);
}

export default definePipeline({
  id: "remotion",
  version: "1.0.0",

  async inputs(ctx) {
    const item = asItem(ctx);
    return {
      text: await scriptText(ctx.inputs, item),
      files: inputPaths(ctx.inputs, item),
    };
  },

  // Renderer code + production inputs are merged into one isolated stage.
  prepare(ctx) {
    const renderer = rendererDir(ctx);
    for (const path of [
      "src",
      "scripts",
      "package.json",
      "tsconfig.json",
      "remotion.config.ts",
    ])
      if (existsSync(resolve(renderer, path)))
        cpSync(resolve(renderer, path), resolve(ctx.stage, path), {
          recursive: true,
        });
    for (const path of ["src", "public", "projects.json"])
      if (existsSync(resolve(ctx.inputs, path)))
        cpSync(resolve(ctx.inputs, path), resolve(ctx.stage, path), {
          recursive: true,
        });
    symlinkSync(
      resolve(renderer, "node_modules"),
      resolve(ctx.stage, "node_modules"),
      "dir",
    );
  },

  fingerprint(ctx) {
    const renderer = rendererDir(ctx),
      manifest = readJson<{ dependencies?: Record<string, string> }>(
        resolve(renderer, "package.json"),
      ),
      lock = resolve(renderer, "package-lock.json");
    return {
      renderer: "remotion",
      renderer_version: manifest.dependencies?.remotion ?? null,
      dependency_lock_sha256: existsSync(lock) ? hashFile(lock).sha256 : null,
      cache_only: process.env.YT_TTS_CACHE_ONLY === "1",
    };
  },

  operations: {
    list: {
      description: "List Remotion projects known to the build script",
      item: false,
      run: (ctx) =>
        ctx.exec([
          "node",
          resolve(ctx.stage, "scripts/build-short.mjs"),
          "--list",
        ]),
    },
    check: {
      description: "Type-check renderer + inputs",
      item: false,
      run: (ctx) => ctx.exec([binary(ctx, "tsc"), "--noEmit"]),
    },
    still: {
      description: "Render one verification frame: still ID [FRAME]",
      parameters: (args) => [args[0] ?? "45"],
      async run(ctx) {
        const output = resolve(ctx.runDir, "frame.png");
        await ctx.exec([
          binary(ctx, "remotion"),
          "still",
          resolve(ctx.stage, "src/index.ts"),
          asItem(ctx).composition,
          output,
          "--frame=" + (ctx.args[0] ?? "45"),
        ]);
        return {
          artifacts: [
            {
              file: output,
              kind: "thumbnail",
              media_type: "image/png",
              role: "render_result",
              verification_only: true,
              title: ctx.selector + " still",
              attributes: { renderer: "remotion" },
            },
          ],
        };
      },
    },
    render: {
      description: "Render the full video",
      parameters: () => [],
      async run(ctx) {
        const output = resolve(ctx.runDir, "video.mp4");
        await ctx.exec([
          binary(ctx, "remotion"),
          "render",
          resolve(ctx.stage, "src/index.ts"),
          asItem(ctx).composition,
          output,
          "--codec=h264",
          "--crf=18",
          "--concurrency=4",
        ]);
        return {
          artifacts: [
            {
              file: output,
              kind: "video",
              media_type: "video/mp4",
              role: "render_result",
              title: ctx.selector + " render",
              attributes: { renderer: "remotion" },
            },
          ],
        };
      },
    },
    package: {
      description: "Build video + thumbnail into exports/<folder>",
      parameters: () => [],
      async run(ctx) {
        await ctx.exec([
          "node",
          resolve(ctx.stage, "scripts/build-short.mjs"),
          ctx.selector!,
        ]);
        const destination = resolve(ctx.exports, asItem(ctx).folder);
        return {
          artifacts: (
            [
              ["video.mp4", "video", "video/mp4"],
              ["thumbnail.png", "thumbnail", "image/png"],
            ] as const
          ).map(([file, kind, media_type]) => ({
            file: resolve(destination, file),
            kind,
            media_type,
            role: "packaged_output",
            title: ctx.selector + " " + file,
            attributes: { renderer: "remotion" },
          })),
        };
      },
    },
    voice: {
      description:
        "Generate narration + caption timing (adopt with --from-run)",
      relation: "generated_from",
      parameters: () => [],
      async run(ctx) {
        const item = asItem(ctx),
          envfile = resolve(ctx.projectRoot, "secrets/production.env");
        await ctx.exec([
          "node",
          ...(existsSync(envfile) ? ["--env-file=" + envfile] : []),
          resolve(ctx.stage, item.voiceScript ?? "scripts/typecast-short.mjs"),
          ctx.selector!,
        ]);
        const timing = readJson<{ audioFile: string }>(
            resolve(ctx.stage, item.timing),
          ),
          audio = "public/" + timing.audioFile,
          files = [
            [voiceFile(item), "metadata", "application/json"],
            [item.timing, "captions", "application/json"],
            [
              audio,
              "audio",
              timing.audioFile.endsWith(".wav") ? "audio/wav" : "audio/mpeg",
            ],
          ] as const;
        return {
          adoptable: files.map(([path]) => path),
          artifacts: files.map(([path, kind, media_type]) => ({
            file: resolve(ctx.stage, path),
            kind,
            media_type,
            role: "voice_result",
            title: ctx.selector + " " + path,
          })),
        };
      },
    },
  },
});
