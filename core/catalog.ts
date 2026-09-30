import Ajv from "ajv";
import { Database } from "bun:sqlite";
import {
  existsSync,
  copyFileSync,
  openSync,
  fsyncSync,
  closeSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  atomicJson,
  durableWrite,
  hash,
  hashFile,
  json,
  newId,
  readJson,
  syncDirectory,
  within,
} from "./files.ts";
import { Registry } from "./registry.ts";
import type {
  Draft,
  Locator,
  Mutation,
  ProjectConfig,
  RecordData,
  Ref,
  StoreName,
} from "./model.ts";

const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const refSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", pattern: uuid },
    revision: { type: "integer", minimum: 1 },
  },
};
const envelope = new Ajv({ allErrors: true }).compile({
  type: "object",
  required: [
    "id",
    "revision",
    "supersedes_revision",
    "type",
    "type_version",
    "owner",
    "title",
    "aliases",
    "recorded_at",
    "recorded_by",
    "lifecycle",
    "locators",
    "attributes",
    "extensions",
  ],
  properties: {
    id: { type: "string", pattern: uuid },
    revision: { type: "integer", minimum: 1 },
    supersedes_revision: { type: ["integer", "null"], minimum: 1 },
    type: { type: "string", pattern: "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$" },
    type_version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
    owner: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    recorded_at: { type: "string", minLength: 1 },
    recorded_by: { type: "string", minLength: 1 },
    lifecycle: { enum: ["active", "deprecated", "tombstone"] },
    aliases: {
      type: "array",
      items: {
        type: "object",
        required: ["namespace", "value"],
        properties: {
          namespace: { type: "string", minLength: 1 },
          value: { type: "string", minLength: 1 },
        },
      },
    },
    locators: {
      type: "array",
      items: {
        type: "object",
        required: ["store", "key", "sha256", "size", "media_type", "role"],
        properties: {
          store: { const: "objects" },
          key: { type: "string" },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          size: { type: "integer", minimum: 0 },
          media_type: { type: "string", minLength: 1 },
          role: { type: "string", minLength: 1 },
        },
      },
    },
    attributes: { type: "object" },
    extensions: { type: "object" },
    relation: {
      type: "object",
      required: [
        "from",
        "to",
        "predicate",
        "predicate_version",
        "scope",
        "evidence_refs",
        "assertion_state",
      ],
      properties: {
        from: refSchema,
        to: refSchema,
        predicate: { type: "string" },
        predicate_version: { type: "string" },
        scope: { type: "object" },
        evidence_refs: { type: "array", items: refSchema },
        assertion_state: {
          enum: ["proposed", "observed", "verified", "disputed"],
        },
      },
    },
  },
});
const stores: StoreName[] = [
  "records",
  "objects",
  "stores",
  "indexes",
  "runs",
  "work",
];
type Commit = {
  id: string;
  generation: number;
  parent: string | null;
  actor: string;
  recorded_at: string;
  entries: { path: string; sha256: string }[];
};
export type Snapshot = {
  generation: number;
  head: string | null;
  all: RecordData[];
  latest: Map<string, RecordData>;
};

export class Catalog {
  readonly root: string;
  readonly config: ProjectConfig;
  readonly registry: Registry;
  constructor(root: string) {
    this.root = resolve(root);
    this.config = readJson<ProjectConfig>(resolve(root, "project.json"));
    const c = this.config;
    if (
      c.format_version !== "1.0.0" ||
      !c.id ||
      !Array.isArray(c.modules) ||
      !c.modules.every((p) => typeof p === "string") ||
      !stores.every((s) => typeof c.stores?.[s] === "string" && c.stores[s])
    )
      throw new Error("Invalid project config");
    const paths = stores.map((s) => this.path(s));
    if (new Set(paths).size !== paths.length)
      throw new Error("Logical stores must use distinct paths");
    this.registry = new Registry(this.root, c.modules);
  }
  path(store: StoreName) {
    return resolve(this.root, this.config.stores[store]);
  }
  init() {
    for (const store of stores)
      mkdirSync(this.path(store), { recursive: true });
    for (const folder of ["commits", "batches"])
      mkdirSync(resolve(this.path("records"), folder), { recursive: true });
  }
  private lock<T>(fn: () => T): T {
    this.init();
    const path = resolve(this.path("records"), ".writer-lock");
    try {
      mkdirSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          "Workspace writer locked; inspect records/.writer-lock before recovering",
        );
      throw error;
    }
    try {
      durableWrite(
        resolve(path, "owner.json"),
        json({ pid: process.pid, at: new Date().toISOString() }),
      );
      return fn();
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  }
  snapshot(): Snapshot {
    const dir = resolve(this.path("records"), "commits");
    const all: RecordData[] = [],
      latest = new Map<string, RecordData>();
    let generation = 0,
      head: string | null = null;
    if (!existsSync(dir)) return { generation, head, all, latest };
    for (const file of readdirSync(dir)
      .filter((f) => /^\d{12}\.json$/.test(f))
      .sort()) {
      const commit = readJson<Commit>(resolve(dir, file));
      if (commit.generation !== generation + 1 || commit.parent !== head)
        throw new Error(`Broken commit chain ${file}`);
      for (const entry of commit.entries) {
        const data = readFileSync(within(this.path("records"), entry.path));
        if (hash(data) !== entry.sha256)
          throw new Error(`Corrupt committed record ${entry.path}`);
        const r = JSON.parse(data.toString()) as RecordData;
        const previous = latest.get(r.id);
        if (
          !envelope(r) ||
          r.revision !== (previous?.revision ?? 0) + 1 ||
          r.supersedes_revision !== (previous?.revision ?? null)
        )
          throw new Error(`Invalid revision ${r.id}`);
        latest.set(r.id, r);
        all.push(r);
      }
      generation = commit.generation;
      head = commit.id;
    }
    return { generation, head, all, latest };
  }
  get(id: string, revision?: number): RecordData | undefined {
    const s = this.snapshot();
    return revision === undefined
      ? s.latest.get(id)
      : s.all.find((r) => r.id === id && r.revision === revision);
  }
  resolveAlias(namespace: string, value: string) {
    return [...this.snapshot().latest.values()].find((r) =>
      r.aliases.some((a) => a.namespace === namespace && a.value === value),
    );
  }
  putObject(data: Uint8Array, media_type: string, role: string): Locator {
    this.init();
    const sha256 = hash(data),
      key = sha256.slice(0, 2) + "/" + sha256;
    const path = within(this.path("objects"), key);
    if (!existsSync(path)) {
      const temp = resolve(this.path("objects"), "." + newId() + ".tmp");
      try {
        durableWrite(temp, data);
        mkdirSync(resolve(this.path("objects"), sha256.slice(0, 2)), {
          recursive: true,
        });
        renameSync(temp, path);
        syncDirectory(resolve(this.path("objects"), sha256.slice(0, 2)));
      } finally {
        rmSync(temp, { force: true });
      }
    }
    const saved = readFileSync(path);
    if (hash(saved) !== sha256 || saved.length !== data.length)
      throw new Error(`Object hash mismatch: ${key}`);
    return {
      store: "objects",
      key,
      sha256,
      size: data.length,
      media_type,
      role,
    };
  }
  putFile(file: string, media_type: string, role: string): Locator {
    this.init();
    const { sha256, size } = hashFile(file),
      key = sha256.slice(0, 2) + "/" + sha256;
    const destination = within(this.path("objects"), key);
    if (!existsSync(destination)) {
      const temp = resolve(this.path("objects"), "." + newId() + ".tmp");
      try {
        copyFileSync(file, temp);
        const check = hashFile(temp);
        if (check.sha256 !== sha256 || check.size !== size)
          throw new Error("Input changed during file import");
        const fd = openSync(temp, "r");
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        mkdirSync(resolve(this.path("objects"), sha256.slice(0, 2)), {
          recursive: true,
        });
        renameSync(temp, destination);
        syncDirectory(resolve(this.path("objects"), sha256.slice(0, 2)));
      } finally {
        rmSync(temp, { force: true });
      }
    }
    const locator: Locator = {
      store: "objects",
      key,
      sha256,
      size,
      media_type,
      role,
    };
    this.verifyObject(locator);
    return locator;
  }
  verifyObject(locator: Locator) {
    const result = hashFile(within(this.path("objects"), locator.key));
    if (result.sha256 !== locator.sha256 || result.size !== locator.size)
      throw new Error("Object hash mismatch: " + locator.key);
  }
  readObject(locator: Locator): Buffer {
    const data = readFileSync(within(this.path("objects"), locator.key));
    if (hash(data) !== locator.sha256 || data.length !== locator.size)
      throw new Error(`Object hash mismatch: ${locator.key}`);
    return data;
  }
  commit(
    mutations: Mutation[],
    actor: string,
  ): { generation: number; ids: string[] } {
    if (!mutations.length)
      return { generation: this.snapshot().generation, ids: [] };
    return this.lock(() => {
      const state = this.snapshot(),
        merged = new Map(state.latest),
        seen = new Set<string>(),
        now = new Date().toISOString();
      const records: RecordData[] = [];
      for (const { record: d, expected_revision } of mutations) {
        if (seen.has(d.id)) throw new Error(`Duplicate ID in batch: ${d.id}`);
        seen.add(d.id);
        const old = state.latest.get(d.id);
        if (
          !Number.isInteger(expected_revision) ||
          expected_revision < 0 ||
          (old?.revision ?? 0) !== expected_revision
        )
          throw new Error(`Revision conflict: ${d.id}`);
        if (old && (old.owner !== d.owner || old.type !== d.type))
          throw new Error(
            "Owner/type migration needs an explicit migration contract",
          );
        const r = {
          ...old,
          ...d,
          revision: expected_revision + 1,
          supersedes_revision: expected_revision || null,
          recorded_at: now,
          recorded_by: actor,
          lifecycle: d.lifecycle ?? old?.lifecycle ?? "active",
          aliases: d.aliases ?? old?.aliases ?? [],
          locators: d.locators ?? old?.locators ?? [],
          attributes: { ...old?.attributes, ...d.attributes },
          extensions: { ...old?.extensions, ...d.extensions },
        } as RecordData;
        if (!envelope(r))
          throw new Error(`Invalid record: ${JSON.stringify(envelope.errors)}`);
        if (
          (r.type === "core.relation") !== Boolean(r.relation) ||
          (r.type === "core.relation" && r.type_version !== "1.0.0")
        )
          throw new Error("Invalid relation envelope");
        this.registry.validate(r);
        for (const locator of r.locators) this.verifyObject(locator);
        records.push(r);
        merged.set(r.id, r);
      }
      const aliases = new Map<string, string>();
      for (const r of merged.values())
        for (const alias of r.aliases) {
          const key = JSON.stringify([alias.namespace, alias.value]);
          if (aliases.has(key) && aliases.get(key) !== r.id)
            throw new Error(`Alias collision: ${key}`);
          aliases.set(key, r.id);
        }
      const find = (ref: Ref) =>
        ref.revision === undefined
          ? merged.get(ref.id)
          : (records.find(
              (r) => r.id === ref.id && r.revision === ref.revision,
            ) ??
            state.all.find(
              (r) => r.id === ref.id && r.revision === ref.revision,
            ));
      for (const r of records)
        if (r.relation) {
          const relation = r.relation,
            definition = this.registry.relation(r);
          const from = find(relation.from),
            to = find(relation.to);
          if (!from || !to)
            throw new Error(`Missing relation endpoint/revision: ${r.id}`);
          if (
            !definition.from_types.includes(from.type) ||
            !definition.to_types.includes(to.type)
          )
            throw new Error(`Invalid relation endpoint type: ${r.id}`);
          if (
            ((definition.pin === "both" || definition.pin === "from") &&
              !relation.from.revision) ||
            ((definition.pin === "both" || definition.pin === "to") &&
              !relation.to.revision)
          )
            throw new Error(`Pinned revision required: ${relation.predicate}`);
          for (const ref of relation.evidence_refs)
            if (!ref.revision || !find(ref))
              throw new Error(
                "Evidence must reference an existing pinned revision",
              );
          if (
            relation.assertion_state === "verified" &&
            !relation.evidence_refs.length
          )
            throw new Error("Verified relation needs evidence");
        }
      const id = newId(),
        entries: Commit["entries"] = [],
        batch = resolve(this.path("records"), "batches", id);
      mkdirSync(batch);
      for (const r of records) {
        const data = json(r),
          path = `batches/${id}/${r.id}.${r.revision}.json`;
        durableWrite(within(this.path("records"), path), data);
        entries.push({ path, sha256: hash(data) });
      }
      syncDirectory(batch);
      syncDirectory(resolve(this.path("records"), "batches"));
      const generation = state.generation + 1;
      const manifest: Commit = {
        id,
        generation,
        parent: state.head,
        actor,
        recorded_at: now,
        entries,
      };
      // Only this final atomic publication makes the entire batch visible.
      atomicJson(
        resolve(
          this.path("records"),
          "commits",
          String(generation).padStart(12, "0") + ".json",
        ),
        manifest,
      );
      return { generation, ids: records.map((r) => r.id) };
    });
  }
  relations(id: string) {
    return [...this.snapshot().latest.values()].filter(
      (r) =>
        r.lifecycle === "active" &&
        r.relation &&
        (r.relation.from.id === id || r.relation.to.id === id),
    );
  }
  export() {
    const s = this.snapshot();
    return {
      format_version: "1.0.0",
      generation: s.generation,
      records: s.all,
    };
  }
  reindex() {
    return this.lock(() => {
      const snapshot = this.snapshot(),
        path = resolve(this.path("indexes"), "catalog.sqlite"),
        temp = path + "." + newId() + ".tmp";
      let db: Database | undefined;
      try {
        db = new Database(temp, { create: true, strict: true });
        db.exec(
          "PRAGMA journal_mode=DELETE; CREATE TABLE meta (generation INTEGER); CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT, title TEXT, body TEXT); CREATE TABLE relations (id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, predicate TEXT); CREATE INDEX relation_from ON relations(from_id); CREATE INDEX relation_to ON relations(to_id);",
        );
        const insert = db.prepare("INSERT INTO records VALUES (?,?,?,?)"),
          link = db.prepare("INSERT INTO relations VALUES (?,?,?,?)");
        db.transaction(() => {
          db!.prepare("INSERT INTO meta VALUES (?)").run(snapshot.generation);
          for (const r of snapshot.latest.values()) {
            insert.run(r.id, r.type, r.title, JSON.stringify(r));
            if (r.relation)
              link.run(
                r.id,
                r.relation.from.id,
                r.relation.to.id,
                r.relation.predicate,
              );
          }
        })();
        const integrity = db.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        };
        if (integrity.integrity_check !== "ok")
          throw new Error("Index integrity check failed");
        db.close();
        db = undefined;
        renameSync(temp, path);
        syncDirectory(this.path("indexes"));
        return { generation: snapshot.generation, count: snapshot.latest.size };
      } finally {
        db?.close();
        rmSync(temp, { force: true });
      }
    });
  }
  search(query = "", type?: string): RecordData[] {
    const state = this.snapshot(),
      path = resolve(this.path("indexes"), "catalog.sqlite");
    if (!existsSync(path)) throw new Error("Index missing; run reindex");
    const db = new Database(path, { readonly: true });
    try {
      if (
        (
          db.query("SELECT generation FROM meta").get() as {
            generation: number;
          }
        ).generation !== state.generation
      )
        throw new Error("Index stale; run reindex");
      return (
        db
          .query(
            "SELECT body FROM records WHERE instr(lower(body),lower(?))>0 AND (? IS NULL OR type=?) ORDER BY id",
          )
          .all(query, type ?? null, type ?? null) as { body: string }[]
      ).map((row) => JSON.parse(row.body));
    } finally {
      db.close();
    }
  }
  doctor() {
    const s = this.snapshot(),
      unknown = [...s.latest.values()]
        .filter((r) => !this.registry.known(r))
        .map((r) => r.id);
    for (const r of s.all)
      for (const locator of r.locators) this.verifyObject(locator);
    let index_generation: number | null = null;
    const path = resolve(this.path("indexes"), "catalog.sqlite");
    if (existsSync(path)) {
      const db = new Database(path, { readonly: true });
      try {
        index_generation = (
          db.query("SELECT generation FROM meta").get() as {
            generation: number;
          }
        ).generation;
      } finally {
        db.close();
      }
    }
    return {
      project: this.config.id,
      modules: [...this.registry.sources.entries()].map(([id, source]) => ({
        id,
        version: this.registry.modules.get(id)!.version,
        kind: source.kind,
        spec: source.spec,
      })),
      generation: s.generation,
      records: s.latest.size,
      revisions: s.all.length,
      unknown_types: unknown,
      index_generation,
      index_stale: index_generation !== s.generation,
      writer_locked: existsSync(resolve(this.path("records"), ".writer-lock")),
    };
  }
}
export function draft(
  owner: string,
  type: string,
  title: string,
  attributes: Record<string, unknown> = {},
  extra: Partial<Draft> = {},
): Draft {
  return {
    id: newId(),
    type,
    type_version: "1.0.0",
    owner,
    title,
    attributes,
    ...extra,
  };
}
export function relationDraft(
  owner: string,
  predicate: string,
  from: Ref,
  to: Ref,
  options: Partial<NonNullable<RecordData["relation"]>> = {},
): Draft {
  return draft(
    owner,
    "core.relation",
    predicate,
    {},
    {
      relation: {
        from,
        to,
        predicate,
        predicate_version: "1.0.0",
        scope: {},
        evidence_refs: [],
        assertion_state: "observed",
        ...options,
      },
    },
  );
}
