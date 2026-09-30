import { Database } from "bun:sqlite";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Catalog } from "../../core/catalog.ts";
import { hash, json } from "../../core/files.ts";

/** Checks actual local data: index rebuild must round-trip committed records. */
export function verifyWorkspace(catalog: Catalog) {
  const before = catalog.export(),
    beforeHash = hash(json(before));
  const rebuild = catalog.reindex(),
    snapshot = catalog.snapshot();
  const expected = [...snapshot.latest.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const actual = catalog.search().sort((a, b) => a.id.localeCompare(b.id));
  if (
    json(expected) !== json(actual) ||
    hash(json(catalog.export())) !== beforeHash
  )
    throw new Error("Index rebuild changed records or failed roundtrip");
  const db = new Database(resolve(catalog.path("indexes"), "catalog.sqlite"), {
    readonly: true,
  });
  try {
    const expectedRelations = expected
      .filter((r) => r.relation)
      .map((r) => ({
        id: r.id,
        from_id: r.relation!.from.id,
        to_id: r.relation!.to.id,
        predicate: r.relation!.predicate,
      }));
    const actualRelations = db
      .query("SELECT id,from_id,to_id,predicate FROM relations ORDER BY id")
      .all();
    if (json(expectedRelations) !== json(actualRelations))
      throw new Error("Relation index differs from committed records");
    return {
      metadata_sha256: beforeHash,
      relations: expectedRelations.length,
      index: rebuild,
    };
  } finally {
    db.close();
  }
}

function treeBytes(path: string): { files: number; bytes: number } {
  if (!existsSync(path)) return { files: 0, bytes: 0 };
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return { files: 0, bytes: 0 };
  if (stat.isFile()) return { files: 1, bytes: stat.size };
  let files = 0,
    bytes = 0;
  for (const entry of readdirSync(path)) {
    const child = treeBytes(resolve(path, entry));
    files += child.files;
    bytes += child.bytes;
  }
  return { files, bytes };
}

export function workspaceUsage(catalog: Catalog) {
  return Object.fromEntries(
    (["records", "objects", "stores", "indexes", "runs", "work"] as const).map(
      (name) => [name, treeBytes(catalog.path(name))],
    ),
  );
}
