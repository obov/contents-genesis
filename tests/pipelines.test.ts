import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Catalog } from "../core/catalog.ts";

const repo = resolve(import.meta.dir, ".."),
  main = resolve(repo, "src/cli/main.ts"),
  roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function cg(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [main, ...args], {
    cwd,
    encoding: "utf8",
  });
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}
const lastJson = (out: string) => JSON.parse(out.trim().split("\n").pop()!);
const readConfig = (root: string) =>
  JSON.parse(readFileSync(resolve(root, "project.json"), "utf8"));
const writeConfig = (root: string, config: unknown) =>
  writeFileSync(resolve(root, "project.json"), JSON.stringify(config, null, 2));

function project(items: Record<string, unknown>) {
  const root = mkdtempSync(resolve(tmpdir(), "cg-pipe-"));
  roots.push(root);
  const r = cg(
    root,
    "init",
    ".",
    "--id",
    "demo",
    "--no-install",
    "--no-renderer",
  );
  if (!r.ok) throw new Error(r.err);
  // Local pipelines import "contents-genesis/production" like a real install.
  mkdirSync(resolve(root, "node_modules"), { recursive: true });
  symlinkSync(repo, resolve(root, "node_modules/contents-genesis"), "dir");
  const inputs = resolve(root, "workspace/stores/production/inputs");
  mkdirSync(inputs, { recursive: true });
  writeFileSync(resolve(inputs, "projects.json"), JSON.stringify(items));
  return { root, inputs };
}

const artifacts = (root: string) =>
  [...new Catalog(root).snapshot().latest.values()].filter(
    (r) => r.type === "production.artifact",
  );
const relations = (root: string, predicate: string) =>
  [...new Catalog(root).snapshot().latest.values()].filter(
    (r) => r.relation?.predicate === predicate,
  );

test("audio-only pipeline: adopt script, generate audio, adopt generated file back", () => {
  const { root, inputs } = project({
    ep1: { pipeline: "tts", script: "ep1.txt" },
  });
  writeFileSync(resolve(inputs, "ep1.txt"), "안녕하세요. 첫 편입니다.");
  mkdirSync(resolve(root, "pipelines/tts"), { recursive: true });
  writeFileSync(
    resolve(root, "pipelines/tts/index.ts"),
    `import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { definePipeline } from "contents-genesis/production";
export default definePipeline({
  id: "fake-tts",
  version: "0.1.0",
  inputs: ({ inputs, item }) => ({
    text: readFileSync(resolve(inputs, String(item.script)), "utf8"),
    files: [String(item.script)],
  }),
  operations: {
    generate: {
      relation: "generated_from",
      async run(ctx) {
        mkdirSync(resolve(ctx.stage, "audio"), { recursive: true });
        const file = resolve(ctx.stage, "audio", ctx.selector + ".wav");
        writeFileSync(file, "RIFF:" + ctx.env.CG_APPROVED_SCRIPT_TEXT);
        return {
          artifacts: [{ file, kind: "audio", media_type: "audio/wav" }],
          adoptable: ["audio/" + ctx.selector + ".wav"],
        };
      },
    },
  },
});
`,
  );
  const config = readConfig(root);
  config.production = { pipelines: { tts: { use: "./pipelines/tts" } } };
  writeConfig(root, config);

  const early = cg(root, "run", "production", "generate", "ep1");
  expect(early.ok).toBe(false);
  expect(early.err).toContain("not adopted");

  expect(cg(root, "run", "production", "adopt", "ep1").ok).toBe(true);
  const run = cg(root, "run", "production", "generate", "ep1");
  expect(run.ok).toBe(true);
  const result = lastJson(run.out);
  expect(result.pipeline).toBe("tts");
  expect(result.outputs).toHaveLength(1);

  const [artifact] = artifacts(root);
  expect(artifact!.type_version).toBe("1.1.0");
  expect(artifact!.attributes.artifact_kind).toBe("audio");
  expect(artifact!.attributes.pipeline).toBe("tts");
  expect(relations(root, "production.generated_from")).toHaveLength(1);
  expect(
    relations(root, "production.belongs_to").length,
  ).toBeGreaterThanOrEqual(2);

  const adopted = cg(
    root,
    "run",
    "production",
    "adopt",
    "ep1",
    "--from-run",
    result.run_id,
  );
  expect(adopted.ok).toBe(true);
  expect(readFileSync(resolve(inputs, "audio/ep1.wav"), "utf8")).toBe(
    "RIFF:안녕하세요. 첫 편입니다.",
  );
});

test("config-only command pipeline produces a blog post without adoption", () => {
  const { root } = project({ p1: { pipeline: "blog", title: "Hello" } });
  mkdirSync(resolve(root, "tools"), { recursive: true });
  writeFileSync(
    resolve(root, "tools/post.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], "<h1>" + process.argv[3] + "</h1>");`,
  );
  const config = readConfig(root);
  config.production = {
    pipelines: {
      blog: {
        use: "@cg/command",
        operations: {
          build: {
            run: ["bun", "tools/post.mjs", "{out}/post.html", "{item.title}"],
            outputs: [{ path: "post.html", kind: "post" }],
          },
        },
      },
    },
  };
  writeConfig(root, config);

  const run = cg(root, "run", "production", "build", "p1");
  expect(run.ok).toBe(true);
  const [artifact] = artifacts(root);
  expect(artifact!.attributes.artifact_kind).toBe("post");
  expect(artifact!.locators[0]!.media_type).toBe("text/html");
  expect(relations(root, "production.rendered_from")).toHaveLength(0);

  const unknown = cg(root, "run", "production", "render", "p1");
  expect(unknown.ok).toBe(false);
  expect(unknown.err).toContain("available: build");
});

test("items pick their pipeline; --pipeline overrides for item-less operations", () => {
  const { root } = project({ a: { pipeline: "one" }, b: { pipeline: "two" } });
  expect(cg(root, "pipeline", "new", "one").ok).toBe(true);
  expect(cg(root, "pipeline", "new", "two").ok).toBe(true);
  expect(readConfig(root).production.default_pipeline).toBe("one");

  expect(
    lastJson(cg(root, "run", "production", "build", "a").out).pipeline,
  ).toBe("one");
  expect(
    lastJson(cg(root, "run", "production", "build", "b").out).pipeline,
  ).toBe("two");
  const kinds = artifacts(root)
    .map((r) => r.attributes.pipeline)
    .sort();
  expect(kinds).toEqual(["one", "two"]);

  const list = cg(root, "pipeline", "list");
  expect(list.ok).toBe(true);
  expect(Object.keys(JSON.parse(list.out))).toEqual(["one", "two"]);

  expect(cg(root, "pipeline", "default", "two").ok).toBe(true);
  expect(cg(root, "pipeline", "remove", "two").ok).toBe(true);
  expect(readConfig(root).production).toEqual({
    pipelines: { one: { use: "./pipelines/one" } },
    default_pipeline: "one",
  });
});

test("legacy production.renderer still means the remotion pipeline", () => {
  const { root } = project({});
  const config = readConfig(root);
  config.production = { renderer: "renderer" };
  writeConfig(root, config);
  const list = JSON.parse(cg(root, "pipeline", "list").out);
  expect(list.remotion.use).toBe("@cg/remotion");
  expect(Object.keys(list.remotion.operations)).toEqual([
    "list",
    "check",
    "still",
    "render",
    "package",
    "voice",
  ]);
  // Editing pipelines materializes the legacy shorthand explicitly.
  expect(cg(root, "pipeline", "add", "voice", "@cg/command").ok).toBe(false);
  expect(readConfig(root).production).toEqual({ renderer: "renderer" });
  expect(cg(root, "pipeline", "new", "voice").ok).toBe(true);
  expect(readConfig(root).production).toEqual({
    pipelines: {
      remotion: { use: "@cg/remotion", renderer: "renderer" },
      voice: { use: "./pipelines/voice" },
    },
    default_pipeline: "remotion",
  });
  expect(existsSync(resolve(root, "pipelines/voice/index.ts"))).toBe(true);
});
