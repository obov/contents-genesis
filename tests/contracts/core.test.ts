import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Catalog, draft, relationDraft } from "../../core/catalog.ts";
import { json, newId, readJson } from "../../core/files.ts";
import type { Draft, ProjectConfig } from "../../core/model.ts";

const repo = resolve(import.meta.dir, "../.."),
  roots: string[] = [];
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "cg-test-"));
  roots.push(root);
  cpSync(resolve(repo, "modules"), resolve(root, "modules"), {
    recursive: true,
    filter: (source) =>
      !source.includes("/node_modules") &&
      !source.includes("/collector") &&
      !source.includes("/renderers"),
  });
  const config = readJson<ProjectConfig>(
    resolve(repo, "tests/fixtures/project.json"),
  );
  writeFileSync(resolve(root, "project.json"), json(config));
  const catalog = new Catalog(root);
  catalog.init();
  return catalog;
}
const write = (catalog: Catalog, ...records: Draft[]) =>
  catalog.commit(
    records.map((record) => ({ expected_revision: 0, record })),
    "process:test",
  );
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("committed records and evidence", () => {
  test("immutable revisions, optimistic concurrency and pinned evidence survive updates", () => {
    const c = setup(),
      source = draft("sources", "sources.document", "원문", {
        source_kind: "official",
      });
    source.locators = [
      c.putObject(Buffer.from("original"), "text/plain", "evidence"),
    ];
    const claim = draft("research", "research.claim", "claim", {
      statement: "reported",
      claim_kind: "reported_fact",
      as_of: "2026-09-29",
    });
    const link = relationDraft(
      "research",
      "research.supported_by",
      { id: claim.id, revision: 1 },
      { id: source.id, revision: 1 },
      {
        scope: { basis: "page 1" },
        evidence_refs: [{ id: source.id, revision: 1 }],
        assertion_state: "verified",
      },
    );
    write(c, source, claim, link);
    c.commit(
      [{ expected_revision: 1, record: { ...source, title: "new title" } }],
      "process:test",
    );
    expect(c.get(source.id, 1)?.title).toBe("원문");
    expect(c.get(source.id)?.revision).toBe(2);
    expect(c.get(link.id)?.relation?.to.revision).toBe(1);
    expect(() =>
      c.commit([{ expected_revision: 1, record: source }], "process:test"),
    ).toThrow("conflict");
    expect(c.relations(source.id)).toHaveLength(1);
  });
  test("invalid schema, missing refs, unpinned inputs and alias collisions publish nothing", () => {
    const c = setup(),
      a = draft("sources", "sources.document", "source", {
        source_kind: "official",
      });
    const b = draft("research", "research.claim", "claim", {
      statement: "hello",
      claim_kind: "reported_fact",
      as_of: "2026-09-29",
    });
    const link = relationDraft(
      "research",
      "research.supported_by",
      { id: b.id, revision: 1 },
      { id: a.id, revision: 1 },
      { scope: { basis: "original" } },
    );
    expect(() => write(c, { ...a, attributes: {} })).toThrow("Schema");
    expect(() => write(c, b, link)).toThrow("Missing relation");
    expect(() =>
      write(c, a, b, {
        ...link,
        relation: { ...link.relation!, to: { id: a.id } },
      }),
    ).toThrow("Pinned");
    const alias = [{ namespace: "test", value: "S07" }];
    expect(() =>
      write(c, { ...a, aliases: alias }, { ...a, id: newId(), aliases: alias }),
    ).toThrow("Alias collision");
    expect(c.snapshot().generation).toBe(0);
  });
  test("orphan batches are invisible, corrupted committed bytes fail closed", () => {
    const c = setup(),
      source = draft("sources", "sources.document", "source", {
        source_kind: "official",
      });
    mkdirSync(resolve(c.path("records"), "batches", "interrupted"));
    writeFileSync(
      resolve(c.path("records"), "batches", "interrupted", "partial.json"),
      "partial",
    );
    expect(c.snapshot().all).toHaveLength(0);
    write(c, source);
    const manifest = readJson<{ entries: { path: string }[] }>(
      resolve(c.path("records"), "commits", "000000000001.json"),
    );
    writeFileSync(
      resolve(c.path("records"), manifest.entries[0]!.path),
      "broken",
    );
    expect(() => c.snapshot()).toThrow("Corrupt committed");
  });
  test("writer lock prevents concurrent publication without touching existing data", () => {
    const c = setup();
    mkdirSync(resolve(c.path("records"), ".writer-lock"));
    expect(() =>
      write(c, draft("sources", "sources.document", "x", { source_kind: "x" })),
    ).toThrow("writer locked");
    expect(c.snapshot().generation).toBe(0);
  });
  test("content addressed objects verify bytes and reject unsafe locators", () => {
    const c = setup(),
      data = Buffer.from("evidence"),
      a = c.putObject(data, "text/plain", "original"),
      b = c.putObject(data, "text/plain", "copy");
    expect(a.key).toBe(b.key);
    expect(() => c.readObject({ ...a, key: "../../project.json" })).toThrow(
      "Unsafe",
    );
    writeFileSync(resolve(c.path("objects"), a.key), "tampered");
    expect(() => c.putObject(data, "text/plain", "original")).toThrow(
      "hash mismatch",
    );
  });
  test("rebuildable index retains IDs, revisions, relations and flags stale generations", () => {
    const c = setup(),
      a = draft("sources", "sources.document", "마이크론 source", {
        source_kind: "official",
      });
    write(c, a);
    c.reindex();
    const before = c.search("마이크론");
    rmSync(c.path("indexes"), { recursive: true });
    c.reindex();
    expect(c.search("마이크론")).toEqual(before);
    c.commit(
      [{ expected_revision: 1, record: { ...a, title: "new" } }],
      "process:test",
    );
    expect(c.doctor().index_stale).toBe(true);
    expect(() => c.search("")).toThrow("stale");
    c.reindex();
    expect(c.search("")[0]?.revision).toBe(2);
  });
});

describe("extension without core changes", () => {
  function comments(c: Catalog) {
    const dir = resolve(c.root, "external-comments");
    mkdirSync(dir);
    writeFileSync(
      resolve(dir, "schema.json"),
      json({
        type: "object",
        required: ["text"],
        properties: { text: { type: "string" } },
        additionalProperties: true,
      }),
    );
    writeFileSync(resolve(dir, "scope.json"), json({ type: "object" }));
    writeFileSync(
      resolve(dir, "module.json"),
      json({
        manifest_version: "1.0.0",
        id: "comments",
        version: "1.0.0",
        requires_core: "1.x",
        requires_modules: { sources: "1.x" },
        types: [
          { name: "comments.thread", version: "1.0.0", schema: "schema.json" },
        ],
        relations: [
          {
            name: "comments.responds_to",
            version: "1.0.0",
            schema: "scope.json",
            from_types: ["comments.thread"],
            to_types: ["sources.document"],
          },
        ],
      }),
    );
    const config = readJson<ProjectConfig>(resolve(c.root, "project.json"));
    config.modules.push(dir);
    writeFileSync(resolve(c.root, "project.json"), json(config));
    return new Catalog(c.root);
  }
  test("external module loads data definitions without executing code; disabling preserves export", () => {
    let c = comments(setup());
    writeFileSync(
      resolve(c.root, "external-comments", "index.ts"),
      'throw new Error("must never run during discovery")',
    );
    const source = draft("sources", "sources.document", "source", {
      source_kind: "original",
    });
    const thread = draft(
      "comments",
      "comments.thread",
      "comment",
      { text: "hello", future_field: { keep: true } },
      { extensions: { "future.v2": { value: 42 } } },
    );
    const link = relationDraft(
      "comments",
      "comments.responds_to",
      { id: thread.id },
      { id: source.id },
    );
    write(c, source, thread, link);
    c.reindex();
    expect(c.search("hello")).toHaveLength(1);
    const config = readJson<ProjectConfig>(resolve(c.root, "project.json"));
    config.modules.pop();
    writeFileSync(resolve(c.root, "project.json"), json(config));
    c = new Catalog(c.root);
    expect(c.registry.known(c.get(thread.id)!)).toBe(false);
    expect(c.get(thread.id)?.attributes.future_field).toEqual({ keep: true });
    expect(c.relations(source.id)).toHaveLength(1);
    expect(c.export().records).toHaveLength(3);
    expect(() =>
      c.commit([{ expected_revision: 1, record: thread }], "process:test"),
    ).toThrow("not installed");
  });
  test("optional fields survive later partial updates, schema revisions coexist", () => {
    const c = comments(setup()),
      thread = draft("comments", "comments.thread", "comment", {
        text: "hello",
        future_field: "preserve",
      });
    write(c, thread);
    const path = resolve(c.root, "external-comments", "module.json"),
      manifest = readJson<any>(path);
    manifest.types.push({ ...manifest.types[0], version: "1.1.0" });
    writeFileSync(path, json(manifest));
    const updated = new Catalog(c.root);
    updated.commit(
      [
        {
          expected_revision: 1,
          record: {
            ...thread,
            type_version: "1.1.0",
            attributes: { text: "new" },
          },
        },
      ],
      "process:test",
    );
    expect(updated.get(thread.id)?.attributes.future_field).toBe("preserve");
    expect(updated.get(thread.id, 1)?.type_version).toBe("1.0.0");
  });
  test("dependency and schema path mistakes fail before reading data", () => {
    const c = comments(setup()),
      path = resolve(c.root, "external-comments", "module.json"),
      manifest = readJson<any>(path);
    manifest.requires_modules.sources = "2.x";
    writeFileSync(path, json(manifest));
    expect(() => new Catalog(c.root)).toThrow("dependency");
    manifest.requires_modules.sources = "1.x";
    manifest.types[0].schema = "../project.json";
    writeFileSync(path, json(manifest));
    expect(() => new Catalog(c.root)).toThrow("Unsafe");
  });
  test("store relocation preserves identities and queries", () => {
    const c = setup(),
      a = draft("sources", "sources.document", "source", {
        source_kind: "official",
      });
    write(c, a);
    c.reindex();
    const config = readJson<ProjectConfig>(resolve(c.root, "project.json"));
    renameWorkspace(c.root);
    for (const key of Object.keys(
      config.stores,
    ) as (keyof ProjectConfig["stores"])[])
      config.stores[key] = config.stores[key].replace(
        "workspace/",
        "relocated/",
      );
    writeFileSync(resolve(c.root, "project.json"), json(config));
    const moved = new Catalog(c.root);
    expect(moved.get(a.id)).toEqual(c.get(a.id));
  });
});
function renameWorkspace(root: string) {
  // Copy then leave the old store untouched, as in a verified storage move.
  cpSync(resolve(root, "workspace"), resolve(root, "relocated"), {
    recursive: true,
    filter: (source) =>
      !source.includes("/node_modules") &&
      !source.includes("/collector") &&
      !source.includes("/renderers"),
  });
}
