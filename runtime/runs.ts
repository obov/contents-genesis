import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Catalog } from "../core/catalog.ts";
import { atomicJson, newId, readJson } from "../core/files.ts";

export type RunPhase =
  | "prepared"
  | "handler_succeeded"
  | "committed"
  | "indexed"
  | "succeeded";

export type RuntimeRun = {
  id: string;
  operation: string;
  started_at: string;
  status: "running" | "failed" | "succeeded";
  phase: RunPhase;
  ended_at?: string | null;
  failed_at?: string;
  resumed_at?: string;
  error?: string | null;
  [key: string]: unknown;
};

const phases: RunPhase[] = [
  "prepared",
  "handler_succeeded",
  "committed",
  "indexed",
  "succeeded",
];

export function phaseAtLeast(run: RuntimeRun, phase: RunPhase) {
  return phases.indexOf(run.phase) >= phases.indexOf(phase);
}

export function parseResumeArgs(args: string[]) {
  const at = args.indexOf("--resume");
  if (at === -1) return { args, resumeId: undefined as string | undefined };
  const resumeId = args[at + 1];
  if (!resumeId) throw new Error("--resume requires a run ID");
  return {
    args: args.filter((_, index) => index !== at && index !== at + 1),
    resumeId,
  };
}

export class RunJournal {
  readonly id: string;
  readonly dir: string;
  readonly file: string;
  state: RuntimeRun;

  private constructor(
    private readonly catalog: Catalog,
    state: RuntimeRun,
  ) {
    this.id = state.id;
    this.dir = resolve(catalog.path("runs"), state.id);
    this.file = resolve(this.dir, "run.json");
    this.state = state;
  }

  static open(
    catalog: Catalog,
    operation: string,
    base: Record<string, unknown> = {},
    resumeId?: string,
    resumeKeys: string[] = [],
  ) {
    catalog.init();
    if (resumeId) {
      const dir = resolve(catalog.path("runs"), resumeId),
        file = resolve(dir, "run.json");
      if (!existsSync(file))
        throw new Error("Resume run not found: " + resumeId);
      const state = readJson<RuntimeRun>(file);
      if (state.id !== resumeId)
        throw new Error("Run directory and ID differ: " + dir);
      if (state.operation !== operation)
        throw new Error("Resume operation mismatch");
      if (state.status === "succeeded")
        throw new Error("Run already succeeded: " + resumeId);
      for (const key of resumeKeys) {
        if (
          key in state &&
          key in base &&
          JSON.stringify(state[key]) !== JSON.stringify(base[key])
        )
          throw new Error("Resume " + key + " mismatch");
      }
      const journal = new RunJournal(catalog, state);
      journal.update({
        status: "running",
        resumed_at: new Date().toISOString(),
        error: null,
        ended_at: null,
      });
      return journal;
    }
    const id = newId(),
      dir = resolve(catalog.path("runs"), id);
    mkdirSync(dir);
    const state: RuntimeRun = {
      ...base,
      id,
      operation,
      started_at: new Date().toISOString(),
      status: "running",
      phase: "prepared",
    };
    const journal = new RunJournal(catalog, state);
    atomicJson(journal.file, state);
    return journal;
  }

  update(patch: Record<string, unknown>) {
    this.state = { ...this.state, ...patch } as RuntimeRun;
    atomicJson(this.file, this.state);
    return this.state;
  }

  mark(
    phase: Exclude<RunPhase, "succeeded">,
    patch: Record<string, unknown> = {},
  ) {
    return this.update({ ...patch, phase, status: "running", error: null });
  }

  fail(error: unknown, patch: Record<string, unknown> = {}) {
    return this.update({
      ...patch,
      status: "failed",
      failed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  succeed(patch: Record<string, unknown> = {}) {
    return this.update({
      ...patch,
      phase: "succeeded",
      status: "succeeded",
      ended_at: new Date().toISOString(),
      error: null,
    });
  }
}

export function listRuntimeRuns(catalog: Catalog) {
  const root = catalog.path("runs");
  if (!existsSync(root)) return [] as RuntimeRun[];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const file = resolve(root, entry.name, "run.json");
      if (!existsSync(file)) return [];
      const run = readJson<RuntimeRun>(file);
      if (run.id !== entry.name)
        throw new Error(
          "Run directory and ID differ: " + resolve(root, entry.name),
        );
      return [run];
    });
}
