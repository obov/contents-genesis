import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Catalog, draft } from "../../core/catalog.ts";
import {
  adoptInputs,
  requireAdoptedInputs,
} from "../../modules/production/src/inputs.ts";
import type {
  Pipeline,
  ProductionItem,
} from "../../modules/production/src/pipeline.ts";
import remotionExport from "../../modules/production/pipelines/remotion/index.ts";

const remotion = remotionExport as Pipeline;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "cg-production-"));
  roots.push(root);
  cpSync(resolve(import.meta.dir, "../../modules"), resolve(root, "modules"), {
    recursive: true,
    filter: (source) =>
      !source.includes("/node_modules") &&
      !source.includes("/collector") &&
      !source.includes("/renderers"),
  });
  cpSync(
    resolve(import.meta.dir, "../fixtures/project.json"),
    resolve(root, "project.json"),
  );
  const inputs = resolve(root, "inputs");
  mkdirSync(resolve(inputs, "src"), { recursive: true });
  mkdirSync(resolve(inputs, "public/audio"), { recursive: true });
  writeFileSync(
    resolve(inputs, "src/script.ts"),
    "export const cues=[{text:'hello'},{text:'world'}] as const;\n",
  );
  writeFileSync(
    resolve(inputs, "src/timing.json"),
    JSON.stringify({ audioFile: "audio/narration.wav" }),
  );
  writeFileSync(resolve(inputs, "src/voice.json"), "{}");
  writeFileSync(resolve(inputs, "public/audio/narration.wav"), "audio");
  return { catalog: new Catalog(root), inputs };
}

const source = (catalog: Catalog, inputs: string) =>
  remotion.inputs!({
    catalog,
    projectRoot: catalog.root,
    inputs,
    exports: resolve(inputs, "../exports"),
    name: "remotion",
    options: { use: "@cg/remotion" },
    selector: "fixture-1",
    item: project,
  });

const project: ProductionItem = {
  folder: "fixture",
  composition: "Fixture",
  cover: "FixtureCover",
  script: "src/script.ts",
  cuesExport: "cues",
  timing: "src/timing.json",
  renderedVideo: "out/video.mp4",
  renderedThumbnail: "out/thumb.png",
  narration: {
    spokenExport: "spoken",
    voice: "src/voice.json",
    audioFile: "audio/narration.wav",
  },
};

test("production adoption pins script/timing/voice/audio and rejects later drift", async () => {
  const { catalog, inputs } = setup();
  const adopted = await adoptInputs(
    catalog,
    inputs,
    "fixture-1",
    project,
    await source(catalog, inputs),
  );
  expect(adopted.script.revision).toBe(1);
  const current = await requireAdoptedInputs(
    catalog,
    inputs,
    "fixture-1",
    project,
    await source(catalog, inputs),
  );
  expect(current.script.attributes.text).toBe("hello\nworld");
  expect((current.script.attributes.adopted_inputs as unknown[]).length).toBe(
    4,
  );

  writeFileSync(
    resolve(inputs, "src/script.ts"),
    "export const cues=[{text:'different'}] as const;\n",
  );
  await expect(
    (async () =>
      requireAdoptedInputs(
        catalog,
        inputs,
        "fixture-1",
        project,
        await source(catalog, inputs),
      ))(),
  ).rejects.toThrow("Adopted input changed");
});

test("production adoption prefers the canonical script alias over a loose stale project match", async () => {
  const { catalog, inputs } = setup();
  catalog.init();
  const canonical = draft(
      "production",
      "production.script",
      "canonical",
      { legacy_project_id: "fixture-1", text: "old canonical" },
      {
        aliases: [{ namespace: "data-collect", value: "script:fixture-1" }],
      },
    ),
    stale = draft("production", "production.script", "stale fixture", {
      legacy_project_id: "fixture-1",
      text: "UNRELATED OLD SCRIPT",
    });
  catalog.commit(
    [
      { expected_revision: 0, record: canonical },
      { expected_revision: 0, record: stale },
    ],
    "test",
  );

  const adopted = await adoptInputs(
    catalog,
    inputs,
    "fixture-1",
    project,
    await source(catalog, inputs),
  );
  expect(adopted.script.id).toBe(canonical.id);
  expect(adopted.script.revision).toBe(2);
  expect(catalog.get(stale.id)?.attributes.text).toBe("UNRELATED OLD SCRIPT");
  expect(catalog.get(canonical.id)?.attributes.text).toBe("hello\nworld");
});
