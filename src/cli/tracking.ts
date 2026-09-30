import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { atomicJson, hash, readJson } from "../../core/files.ts";
import type { Manifest, ProjectConfig } from "../../core/model.ts";
import { resolveModule } from "../../core/resolve.ts";

/**
 * Configuration tracking. `.cg/state.json` holds the last observed fingerprint;
 * `.cg/history.jsonl` is an append-only log of configuration changes, both
 * made through cg and made by editing files directly ("external").
 */

export const CG_DIR = ".cg";

type ModuleState = {
  id: string;
  version: string;
  kind: string;
  /** Content hash for project-owned (local/ejected) module directories. */
  sha256?: string;
};
export type State = {
  project_sha256: string;
  modules: Record<string, ModuleState>;
  pipelines: Record<
    string,
    { use: string; options_sha256: string; sha256?: string }
  >;
  default_pipeline: string | null;
  skills: { shared: string[]; project: Record<string, string> };
};
export type Change = { kind: string; target: string; detail?: string };
export type HistoryEntry = {
  at: string;
  actor: string;
  source: "cg" | "external" | "baseline";
  /** For external changes: who ran cg when the change was noticed. */
  observed_by?: string;
  command?: string;
  changes: Change[];
};

const IGNORE = new Set(["node_modules", ".DS_Store", "out"]);

/** Stable content hash of a directory tree (paths + file bytes). */
export function treeHash(dir: string): string {
  const parts: string[] = [];
  const walk = (at: string, prefix: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (IGNORE.has(entry.name)) continue;
      const full = resolve(at, entry.name),
        rel = prefix + entry.name;
      if (entry.isDirectory()) walk(full, rel + "/");
      else if (entry.isFile())
        parts.push(rel + "\0" + hash(readFileSync(full)));
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return hash(parts.join("\n"));
}

/** Per-file hashes, used to report which ejected files were edited. */
export function fileHashes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string, prefix: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (IGNORE.has(entry.name) || entry.name === "EJECTED.json") continue;
      const full = resolve(at, entry.name),
        rel = prefix + entry.name;
      if (entry.isDirectory()) walk(full, rel + "/");
      else if (entry.isFile()) out[rel] = hash(readFileSync(full));
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out;
}

const isLocalUse = (use: string) => use.startsWith(".") || use.startsWith("/");

export function fingerprint(root: string): State {
  const file = resolve(root, "project.json"),
    raw = readFileSync(file, "utf8"),
    config = JSON.parse(raw) as ProjectConfig;
  const modules: State["modules"] = {};
  for (const spec of config.modules ?? []) {
    try {
      const source = resolveModule(root, spec),
        manifest = readJson<Manifest>(resolve(source.dir, "module.json"));
      modules[spec] = {
        id: manifest.id,
        version: manifest.version,
        kind: source.kind,
        ...(source.kind === "local" ? { sha256: treeHash(source.dir) } : {}),
      };
    } catch (error) {
      modules[spec] = {
        id: "?",
        version: "?",
        kind: "unresolved: " + (error as Error).message,
      };
    }
  }
  const pipelines: State["pipelines"] = {};
  // Same effective view as the production runner: legacy renderer → remotion.
  const configured =
    config.production?.pipelines ??
    ({
      remotion: {
        use: "@cg/remotion",
        renderer: config.production?.renderer ?? "renderer",
      },
    } as Record<string, { use: string }>);
  for (const [name, options] of Object.entries(configured)) {
    const use = String(options.use);
    pipelines[name] = {
      use,
      options_sha256: hash(JSON.stringify(options)),
      ...(isLocalUse(use) ? { sha256: treeHash(resolve(root, use)) } : {}),
    };
  }
  const skillsDir = resolve(root, ".agents/skills"),
    project: Record<string, string> = {};
  if (existsSync(skillsDir))
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }))
      if (entry.isDirectory() && !entry.name.startsWith("."))
        project[entry.name] = treeHash(resolve(skillsDir, entry.name));
  return {
    project_sha256: hash(raw),
    modules,
    pipelines,
    default_pipeline: config.production?.default_pipeline ?? null,
    skills: { shared: [...(config.skills ?? [])].sort(), project },
  };
}

export function diffStates(before: State, after: State): Change[] {
  const changes: Change[] = [];
  const keyed = <T>(
    kind: string,
    a: Record<string, T>,
    b: Record<string, T>,
    label: (key: string, value: T) => string,
    detail: (x: T, y: T) => string | undefined,
  ) => {
    for (const key of Object.keys(b))
      if (!(key in a))
        changes.push({ kind: kind + "_added", target: label(key, b[key]!) });
    for (const key of Object.keys(a))
      if (!(key in b))
        changes.push({ kind: kind + "_removed", target: label(key, a[key]!) });
    for (const key of Object.keys(a))
      if (key in b && JSON.stringify(a[key]) !== JSON.stringify(b[key]))
        changes.push({
          kind: kind + "_changed",
          target: label(key, b[key]!),
          detail: detail(a[key]!, b[key]!),
        });
  };
  keyed(
    "module",
    before.modules,
    after.modules,
    (spec, m) => `${m.id} (${spec})`,
    (x, y) =>
      x.version !== y.version
        ? `version ${x.version} → ${y.version}`
        : x.kind !== y.kind
          ? `kind ${x.kind} → ${y.kind}`
          : "files edited",
  );
  keyed(
    "pipeline",
    before.pipelines,
    after.pipelines,
    (name, p) => `${name} (${p.use})`,
    (x, y) =>
      x.use !== y.use
        ? `use ${x.use} → ${y.use}`
        : x.options_sha256 !== y.options_sha256
          ? "options edited"
          : "files edited",
  );
  if (before.default_pipeline !== after.default_pipeline)
    changes.push({
      kind: "default_pipeline_changed",
      target: String(after.default_pipeline),
      detail: `${before.default_pipeline} → ${after.default_pipeline}`,
    });
  const shared = (s: State) =>
    Object.fromEntries(s.skills.shared.map((n) => [n, n]));
  keyed(
    "shared_skill",
    shared(before),
    shared(after),
    (n) => n,
    () => undefined,
  );
  keyed(
    "project_skill",
    before.skills.project,
    after.skills.project,
    (n) => n,
    () => "files edited",
  );
  if (!changes.length && before.project_sha256 !== after.project_sha256)
    changes.push({ kind: "project_json_changed", target: "project.json" });
  return changes;
}

export function actor() {
  if (process.env.CG_ACTOR) return process.env.CG_ACTOR;
  if (process.env.CLAUDECODE) return "agent:claude-code";
  if (process.env.CODEX_SANDBOX || process.env.CODEX_HOME) return "agent:codex";
  return "human";
}

const statePath = (root: string) => resolve(root, CG_DIR, "state.json"),
  historyPath = (root: string) => resolve(root, CG_DIR, "history.jsonl");

export function readHistory(root: string): HistoryEntry[] {
  const file = historyPath(root);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HistoryEntry);
}

function append(root: string, entry: HistoryEntry) {
  mkdirSync(resolve(root, CG_DIR), { recursive: true });
  appendFileSync(historyPath(root), JSON.stringify(entry) + "\n");
}

/**
 * Compare the stored fingerprint with the current files. Differences not made
 * through cg are logged as "external". Returns the current fingerprint.
 */
export function observe(root: string): State {
  const current = fingerprint(root),
    file = statePath(root);
  if (!existsSync(file)) {
    append(root, {
      at: new Date().toISOString(),
      actor: actor(),
      source: "baseline",
      changes: [
        ...Object.entries(current.modules).map(([spec, m]) => ({
          kind: "module_present",
          target: `${m.id} (${spec})`,
        })),
        ...Object.entries(current.pipelines).map(([name, p]) => ({
          kind: "pipeline_present",
          target: `${name} (${p.use})`,
        })),
      ],
    });
    atomicJson(file, current);
    return current;
  }
  const previous = readJson<State>(file),
    changes = diffStates(previous, current);
  if (changes.length) {
    append(root, {
      at: new Date().toISOString(),
      actor: "unknown",
      observed_by: actor(),
      source: "external",
      changes,
    });
    atomicJson(file, current);
  }
  return current;
}

/** Record changes made by a cg command (before = fingerprint from observe). */
export function recordCommand(root: string, before: State, command: string) {
  const after = fingerprint(root),
    changes = diffStates(before, after);
  if (!changes.length) return;
  append(root, {
    at: new Date().toISOString(),
    actor: actor(),
    source: "cg",
    command,
    changes,
  });
  atomicJson(statePath(root), after);
}
