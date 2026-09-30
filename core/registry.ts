import Ajv, { type ValidateFunction } from "ajv";
import { dirname, resolve } from "node:path";
import { satisfies, valid, validRange } from "semver";
import {
  CORE_VERSION,
  type Manifest,
  type RecordData,
  type RelationDefinition,
} from "./model.ts";
import { lexicallyWithin, readJson } from "./files.ts";
import { resolveModule, type ModuleSource } from "./resolve.ts";

type Registered = {
  owner: string;
  validate: ValidateFunction;
  definition?: RelationDefinition;
};
const manifestSchema = {
  type: "object",
  required: [
    "manifest_version",
    "id",
    "version",
    "requires_core",
    "types",
    "relations",
  ],
  properties: {
    manifest_version: { const: "1.0.0" },
    id: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
    version: { type: "string" },
    requires_core: { type: "string" },
    requires_modules: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    types: { type: "array", items: { $ref: "#/definitions/type" } },
    relations: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "version", "schema", "from_types", "to_types"],
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          schema: { type: "string" },
          from_types: { type: "array", minItems: 1, items: { type: "string" } },
          to_types: { type: "array", minItems: 1, items: { type: "string" } },
          pin: { enum: ["both", "from", "to"] },
        },
      },
    },
  },
  definitions: {
    type: {
      type: "object",
      required: ["name", "version", "schema"],
      properties: {
        name: { type: "string" },
        version: { type: "string" },
        schema: { type: "string" },
      },
    },
  },
};
export class Registry {
  readonly modules = new Map<string, Manifest>();
  readonly sources = new Map<string, ModuleSource>();
  private types = new Map<string, Registered>();
  private relations = new Map<string, Registered>();
  constructor(root: string, specs: string[]) {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validateManifest = ajv.compile(manifestSchema);
    const manifests = specs.map((spec) => {
      const source = resolveModule(root, spec),
        file = resolve(source.dir, "module.json");
      const manifest = readJson<Manifest>(file);
      if (!validateManifest(manifest))
        throw new Error(
          `Invalid manifest ${file}: ${ajv.errorsText(validateManifest.errors)}`,
        );
      if (
        !valid(manifest.version) ||
        !validRange(manifest.requires_core) ||
        !satisfies(CORE_VERSION, manifest.requires_core)
      )
        throw new Error(`Incompatible core for ${manifest.id}`);
      if (manifest.id === "core" || this.modules.has(manifest.id))
        throw new Error(`Duplicate/reserved module ${manifest.id}`);
      this.modules.set(manifest.id, manifest);
      this.sources.set(manifest.id, source);
      return { manifest, dir: dirname(file) };
    });
    for (const { manifest: m, dir } of manifests) {
      for (const [dependency, range] of Object.entries(
        m.requires_modules ?? {},
      )) {
        const other = this.modules.get(dependency);
        if (!other || !validRange(range) || !satisfies(other.version, range))
          throw new Error(
            `Missing/incompatible dependency ${m.id} -> ${dependency}`,
          );
      }
      for (const kind of ["types", "relations"] as const) {
        for (const definition of m[kind]) {
          if (
            !definition.name.startsWith(m.id + ".") ||
            !valid(definition.version)
          )
            throw new Error(`Invalid namespaced definition ${definition.name}`);
          const key = definition.name + "@" + definition.version;
          const map = kind === "types" ? this.types : this.relations;
          if (map.has(key)) throw new Error(`Duplicate definition ${key}`);
          // Schemas are read as data; registration never imports or executes handlers.
          // Lexical check only: package managers may install modules as symlinks.
          const validator = new Ajv({ allErrors: true, strict: true }).compile(
            readJson<object>(lexicallyWithin(dir, definition.schema)),
          );
          map.set(key, {
            owner: m.id,
            validate: validator,
            ...(kind === "relations"
              ? { definition: definition as RelationDefinition }
              : {}),
          });
        }
      }
    }
    for (const { manifest: m } of manifests)
      for (const relation of m.relations) {
        for (const type of [...relation.from_types, ...relation.to_types]) {
          const owner = type.split(".")[0]!;
          if (owner !== m.id && !m.requires_modules?.[owner])
            throw new Error(`Undeclared dependency ${m.id} -> ${owner}`);
          if (![...this.types.keys()].some((key) => key.startsWith(type + "@")))
            throw new Error(`Unknown endpoint type ${type}`);
        }
      }
  }
  known(record: RecordData): boolean {
    return record.type === "core.relation"
      ? this.relations.has(
          record.relation?.predicate + "@" + record.relation?.predicate_version,
        )
      : this.types.has(record.type + "@" + record.type_version);
  }
  validate(record: RecordData) {
    const relation = record.relation;
    const key =
      record.type === "core.relation"
        ? relation?.predicate + "@" + relation?.predicate_version
        : record.type + "@" + record.type_version;
    const definition = (
      record.type === "core.relation" ? this.relations : this.types
    ).get(key);
    if (!definition) throw new Error(`Type definition not installed: ${key}`);
    if (definition.owner !== record.owner)
      throw new Error(`Owner mismatch: ${key}`);
    if (
      !definition.validate(
        record.type === "core.relation" ? relation?.scope : record.attributes,
      )
    )
      throw new Error(
        `Schema ${key}: ${JSON.stringify(definition.validate.errors)}`,
      );
  }
  relation(record: RecordData): RelationDefinition {
    const r = record.relation!;
    const definition = this.relations.get(
      r.predicate + "@" + r.predicate_version,
    )?.definition;
    if (!definition) throw new Error(`Unknown relation ${r.predicate}`);
    return definition;
  }
}
