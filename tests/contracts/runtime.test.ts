import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Catalog } from "../../core/catalog.ts";
import { RunJournal } from "../../runtime/runs.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "cg-runtime-"));
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
  return new Catalog(root);
}

test("run journal resumes after handler success without changing operation", () => {
  const catalog = setup(),
    first = RunJournal.open(catalog, "sources.fetch", { parameters: ["x"] });
  first.mark("handler_succeeded", { external_effect: 1 });
  first.fail(new Error("catalog locked"));

  const resumed = RunJournal.open(
    catalog,
    "sources.fetch",
    { parameters: ["x"] },
    first.id,
    ["parameters"],
  );
  expect(resumed.state.phase).toBe("handler_succeeded");
  expect(resumed.state.status).toBe("running");
  expect(resumed.state.external_effect).toBe(1);
  expect(() => RunJournal.open(catalog, "sources.rss", {}, first.id)).toThrow(
    "Resume operation mismatch",
  );
  expect(() =>
    RunJournal.open(
      catalog,
      "sources.fetch",
      { parameters: ["different"] },
      first.id,
      ["parameters"],
    ),
  ).toThrow("Resume parameters mismatch");
});
