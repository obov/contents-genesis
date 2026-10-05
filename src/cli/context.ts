import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Catalog } from "../../core/catalog.ts";
import { readJson } from "../../core/files.ts";
import type { Manifest, ProjectConfig } from "../../core/model.ts";
import { builtinDir } from "../../core/resolve.ts";
import { listRuntimeRuns } from "../../runtime/runs.ts";
import {
  PACKAGE_VERSION,
  dependentsOf,
  loadManifests,
  readProject,
} from "./project.ts";
import { fileHashes, readHistory, type HistoryEntry } from "./tracking.ts";
import { skillDirName, versionOf } from "./skills.ts";

/**
 * Agent-facing snapshot of how this project is assembled: which modules and
 * pipelines are active, what was customized, what drifted, what ran recently.
 */

type Ejected = {
  from: string;
  ejected_at?: string;
  base_version?: string;
  upstream_version: string;
  edited: string[];
  added: string[];
  removed: string[];
  upstream_changed: boolean | null;
};
type ModuleInfo = {
  id: string;
  version: string;
  kind: string;
  spec: string;
  path: string;
  requires: string[];
  required_by: string[];
  types: { name: string; version: string; required: string[] }[];
  relations: { name: string; from: string[]; to: string[]; pin?: string }[];
  records: number;
  has_code: string[];
  /** Real location when the module path is a symlink (e.g. `link:` install). */
  linked_to?: string;
  /** Linked outside the project: other projects may share its files. */
  shared?: boolean;
  docs?: string;
  ejected?: Ejected;
};
type PipelineInfo = {
  name: string;
  use: string;
  default: boolean;
  id?: string;
  version?: string;
  adoption?: boolean;
  operations?: Record<string, string>;
  error?: string;
};
export type Inventory = {
  project: { id: string; root: string; contents_genesis: string };
  modules: ModuleInfo[];
  pipelines: PipelineInfo[];
  skills: {
    shared: { name: string; linked: boolean; version?: string }[];
    project: { name: string; version?: string }[];
  };
  workspace: {
    records: number;
    unknown_type_records: number;
    runs: number;
    failed_runs: number;
    recent_runs: {
      id: string;
      operation: string;
      status: string;
      pipeline?: string;
      item?: string | null;
      at: string;
      error?: string | null;
    }[];
  } | null;
  history: HistoryEntry[];
  warnings: string[];
};

const rel = (root: string, path: string) => {
  const r = relative(root, path);
  return r.startsWith("..") ? path : "./" + r;
};

function ejectInfo(dir: string, id: string): Ejected | undefined {
  const file = resolve(dir, "EJECTED.json");
  if (!existsSync(file)) return undefined;
  const meta = readJson<{
      from: string;
      ejected_at?: string;
      module_version?: string;
      original_files?: Record<string, string>;
    }>(file),
    current = fileHashes(dir),
    upstreamDir = builtinDir(id),
    upstream = existsSync(upstreamDir) ? fileHashes(upstreamDir) : {},
    original = meta.original_files;
  const upstreamVersion = existsSync(resolve(upstreamDir, "module.json"))
    ? readJson<Manifest>(resolve(upstreamDir, "module.json")).version
    : "?";
  return {
    from: meta.from,
    ejected_at: meta.ejected_at,
    base_version: meta.module_version,
    upstream_version: upstreamVersion,
    edited: original
      ? Object.keys(current).filter(
          (f) => f in original && original[f] !== current[f],
        )
      : [],
    added: original ? Object.keys(current).filter((f) => !(f in original)) : [],
    removed: original
      ? Object.keys(original).filter((f) => !(f in current))
      : [],
    upstream_changed: original
      ? JSON.stringify(Object.entries(original).sort()) !==
        JSON.stringify(Object.entries(upstream).sort())
      : upstreamVersion !== meta.module_version,
  };
}

/** Symlinked install (`link:`, `bun link`): where the files really live. */
function linkInfo(root: string, dir: string) {
  let real: string, realRoot: string;
  try {
    real = realpathSync(dir);
    realRoot = realpathSync(root);
  } catch {
    return {};
  }
  // Compare against the real root so OS-level aliases (/tmp → /private/tmp) don't count.
  if (real === resolve(realRoot, relative(root, dir))) return {};
  const outside = relative(realRoot, real).startsWith("..");
  return {
    linked_to: outside ? relative(realRoot, real) : rel(realRoot, real),
    ...(outside ? { shared: true } : {}),
  };
}

function codeFiles(dir: string) {
  const out: string[] = [];
  for (const name of ["run.ts", "src", "pipelines"])
    if (existsSync(resolve(dir, name))) out.push(name);
  return out;
}

export async function inventory(
  root: string,
  historyLimit = 10,
): Promise<Inventory> {
  const config: ProjectConfig = readProject(root),
    warnings: string[] = [];

  // Modules (read manifests directly so a broken set still reports).
  let loaded: ReturnType<typeof loadManifests> = [];
  const resolvable: string[] = [];
  for (const spec of config.modules ?? [])
    try {
      loaded.push(...loadManifests(root, [spec]));
      resolvable.push(spec);
    } catch (error) {
      warnings.push(`module ${spec} unresolved: ${(error as Error).message}`);
    }

  let catalog: Catalog | undefined;
  try {
    catalog = new Catalog(root);
  } catch (error) {
    warnings.push("registry invalid: " + (error as Error).message);
  }
  const snapshot = catalog?.snapshot(),
    latest = snapshot
      ? [...snapshot.latest.values()].filter((r) => r.lifecycle !== "tombstone")
      : [],
    countBy = new Map<string, number>();
  for (const r of latest) {
    const owner = r.owner;
    countBy.set(owner, (countBy.get(owner) ?? 0) + 1);
  }

  const modules: ModuleInfo[] = loaded.map((m) => {
    const ejected =
      m.kind === "local" ? ejectInfo(m.dir, m.manifest.id) : undefined;
    if (ejected?.upstream_changed)
      warnings.push(
        `ejected module ${m.manifest.id}: upstream changed since eject (base ${ejected.base_version}, upstream ${ejected.upstream_version}); review and merge manually`,
      );
    return {
      id: m.manifest.id,
      version: m.manifest.version,
      kind: ejected ? "ejected" : m.kind,
      spec: m.spec,
      path: m.kind === "builtin" ? m.spec : rel(root, m.dir),
      requires: Object.keys(m.manifest.requires_modules ?? {}),
      required_by: dependentsOf(loaded, m.manifest.id),
      types: m.manifest.types.map((t) => {
        let required: string[] = [];
        try {
          required =
            readJson<{ required?: string[] }>(resolve(m.dir, t.schema))
              .required ?? [];
        } catch {}
        return { name: t.name, version: t.version, required };
      }),
      relations: m.manifest.relations.map((r) => ({
        name: r.name,
        from: r.from_types,
        to: r.to_types,
        ...(r.pin ? { pin: r.pin } : {}),
      })),
      records: countBy.get(m.manifest.id) ?? 0,
      has_code: codeFiles(m.dir),
      ...(m.kind === "builtin" ? {} : linkInfo(root, m.dir)),
      ...(existsSync(resolve(m.dir, "README.md"))
        ? {
            docs:
              (m.kind === "builtin" ? m.dir : rel(root, m.dir)) + "/README.md",
          }
        : {}),
      ...(ejected ? { ejected } : {}),
    };
  });

  // Pipelines (loaded through the installed production module's contract).
  const pipelines: PipelineInfo[] = [];
  const production = loaded.find((m) => m.manifest.id === "production");
  if (production) {
    const contract = (await import(
      resolve(production.dir, "src/pipeline.ts")
    )) as typeof import("../../modules/production/src/pipeline.ts");
    const { pipelines: configured, fallback } = contract.pipelineConfig(config);
    for (const [name, options] of Object.entries(configured)) {
      const info: PipelineInfo = {
        name,
        use: options.use,
        default: name === fallback,
      };
      try {
        const { pipeline } = await contract.loadPipeline(root, options);
        Object.assign(info, {
          id: pipeline.id,
          version: pipeline.version,
          adoption: Boolean(pipeline.inputs),
          operations: Object.fromEntries(
            Object.entries(pipeline.operations).map(([op, def]) => [
              op,
              def.description ?? "",
            ]),
          ),
        });
      } catch (error) {
        info.error = (error as Error).message;
        warnings.push(`pipeline ${name} failed to load: ${info.error}`);
      }
      pipelines.push(info);
    }
  }

  // Skills.
  const skillsDir = resolve(root, ".agents/skills"),
    present = existsSync(skillsDir) ? readdirSync(skillsDir) : [];
  const isLink = (name: string) => {
    try {
      return lstatSync(resolve(skillsDir, name)).isSymbolicLink();
    } catch {
      return false;
    }
  };
  const shared = (config.skills ?? []).map((name) => ({
    name,
    linked:
      isLink(skillDirName(name)) &&
      existsSync(resolve(skillsDir, skillDirName(name), "SKILL.md")),
    ...versionOf(resolve(skillsDir, skillDirName(name))),
  }));
  for (const s of shared)
    if (!s.linked)
      warnings.push(`shared skill ${s.name} not linked; run cg skill link`);
  const projectSkills = present
    .filter((n) => !n.startsWith(".") && !isLink(n))
    .map((name) => ({ name, ...versionOf(resolve(skillsDir, name)) }));

  // Workspace + runs.
  let workspace: Inventory["workspace"] = null;
  if (catalog && snapshot) {
    const unknown = latest.filter((r) => !catalog!.registry.known(r)).length;
    if (unknown)
      warnings.push(
        `${unknown} records have types from modules not installed (kept, not validated)`,
      );
    let runs: ReturnType<typeof listRuntimeRuns> = [];
    try {
      runs = listRuntimeRuns(catalog);
    } catch (error) {
      warnings.push("runs unreadable: " + (error as Error).message);
    }
    runs.sort((a, b) =>
      String(b.started_at).localeCompare(String(a.started_at)),
    );
    const failed = runs.filter((r) => r.status === "failed");
    if (failed[0] && failed[0] === runs[0])
      warnings.push(
        `last run failed: ${failed[0].operation} (${failed[0].id}): ${failed[0].error}`,
      );
    workspace = {
      records: latest.length,
      unknown_type_records: unknown,
      runs: runs.length,
      failed_runs: failed.length,
      recent_runs: runs.slice(0, 5).map((r) => ({
        id: r.id,
        operation: r.operation,
        status: r.status,
        pipeline: typeof r.pipeline === "string" ? r.pipeline : undefined,
        item: (r.project_id as string | null | undefined) ?? null,
        at: r.started_at,
        ...(r.status === "failed" ? { error: r.error } : {}),
      })),
    };
  }

  const history = readHistory(root);
  return {
    project: { id: config.id, root, contents_genesis: PACKAGE_VERSION },
    modules,
    pipelines,
    skills: { shared, project: projectSkills },
    workspace,
    history: history.slice(-historyLimit).reverse(),
    warnings,
  };
}

// ---------- rendering ----------

const day = (iso: string) => iso.replace("T", " ").slice(0, 16);
const versioned = (s: { name: string; version?: string }) =>
  s.version ? `${s.name}@${s.version}` : s.name;
const changeLine = (e: HistoryEntry) => {
  const who =
    e.source === "external" ? `observed by ${e.observed_by}` : e.actor;
  if (e.source === "baseline") {
    const count = (kind: string) =>
      e.changes.filter((c) => c.kind === kind).length;
    return `${day(e.at)} baseline (${who}): tracking started with ${count("module_present")} modules, ${count("pipeline_present")} pipelines`;
  }
  return (
    `${day(e.at)} ${e.source}${e.command ? ` \`cg ${e.command}\`` : ""} (${who}): ` +
    e.changes
      .map((c) => `${c.kind} ${c.target}${c.detail ? ` [${c.detail}]` : ""}`)
      .join("; ")
  );
};

function customizations(inv: Inventory) {
  return inv.modules
    .filter((m) => m.kind !== "builtin")
    .map((m) => {
      if (!m.ejected) return `${m.id}: ${m.kind} ${m.path}`;
      const e = m.ejected,
        edits = [
          e.edited.length ? `edited ${e.edited.join(", ")}` : "",
          e.added.length ? `added ${e.added.join(", ")}` : "",
          e.removed.length ? `removed ${e.removed.join(", ")}` : "",
        ].filter(Boolean);
      return `${m.id}: ejected from ${e.from}@${e.base_version} → ${m.path}; ${edits.join("; ") || "no local edits"}; upstream ${e.upstream_changed ? `CHANGED (now ${e.upstream_version})` : "unchanged"}`;
    });
}

export function renderBrief(inv: Inventory) {
  const lines = [
    `# cg context: ${inv.project.id} (contents-genesis ${inv.project.contents_genesis})`,
    `modules(${inv.modules.length}): ` +
      inv.modules
        .map(
          (m) =>
            `${m.id}@${m.version}${m.kind === "builtin" ? "" : `[${m.kind}]`}`,
        )
        .join(", "),
  ];
  const custom = customizations(inv);
  if (custom.length) lines.push("customized: " + custom.join(" | "));
  if (inv.pipelines.length)
    lines.push(
      "pipelines: " +
        inv.pipelines
          .map(
            (p) =>
              `${p.name}${p.default ? "*" : ""}(${p.use}${p.operations ? ": " + Object.keys(p.operations).join(",") : ""})`,
          )
          .join(" "),
    );
  lines.push(
    `skills: shared ${inv.skills.shared.map(versioned).join(", ") || "-"}; project ${inv.skills.project.map(versioned).join(", ") || "-"}`,
  );
  if (inv.workspace) {
    const last = inv.workspace.recent_runs[0];
    lines.push(
      `workspace: ${inv.workspace.records} records, ${inv.workspace.runs} runs` +
        (last
          ? ` (last: ${[last.operation, last.item, last.status, day(last.at)].filter(Boolean).join(" ")})`
          : ""),
    );
  }
  if (inv.history.length) {
    lines.push("recent config changes:");
    for (const e of inv.history.slice(0, 3)) lines.push("- " + changeLine(e));
  }
  if (inv.warnings.length) {
    lines.push("warnings:");
    for (const w of inv.warnings) lines.push("- " + w);
  }
  lines.push(
    "details: `bun cg context` | `bun cg context module <id>` | `bun cg context pipeline <name>` | `bun cg context history`",
  );
  return lines.join("\n");
}

export function renderFull(inv: Inventory) {
  const out = [renderBrief(inv).split("\n")[0]!, ""];
  out.push(
    "## Modules",
    "",
    "| id | version | kind | path | requires | records | code |",
    "|---|---|---|---|---|---|---|",
  );
  for (const m of inv.modules)
    out.push(
      `| ${m.id} | ${m.version} | ${m.kind} | ${m.path} | ${m.requires.join(", ") || "-"} | ${m.records} | ${m.has_code.join(", ") || "-"} |`,
    );
  const custom = customizations(inv);
  out.push(
    "",
    "## Customizations",
    "",
    ...(custom.length ? custom.map((c) => "- " + c) : ["- none (all builtin)"]),
  );
  out.push("", "## Pipelines", "");
  if (!inv.pipelines.length) out.push("- none");
  for (const p of inv.pipelines)
    out.push(
      `- **${p.name}**${p.default ? " (default)" : ""}: \`${p.use}\`${p.id ? ` → ${p.id}@${p.version}` : ""}${p.adoption ? ", requires adopt" : ""}${p.error ? ` ERROR ${p.error}` : ""}`,
      ...Object.entries(p.operations ?? {}).map(
        ([op, d]) => `  - \`${op}\`${d ? ": " + d : ""}`,
      ),
    );
  out.push(
    "",
    "## Skills",
    "",
    `- shared: ${inv.skills.shared.map((s) => versioned(s) + (s.linked ? "" : " (NOT LINKED)")).join(", ") || "-"}`,
    `- project: ${inv.skills.project.map(versioned).join(", ") || "-"}`,
  );
  if (inv.workspace) {
    out.push(
      "",
      "## Workspace",
      "",
      `- records ${inv.workspace.records} (unknown types ${inv.workspace.unknown_type_records}), runs ${inv.workspace.runs} (failed ${inv.workspace.failed_runs})`,
      ...inv.workspace.recent_runs.map(
        (r) =>
          `- ${day(r.at)} ${r.operation}${r.item ? " " + r.item : ""}${r.pipeline ? ` [${r.pipeline}]` : ""}: ${r.status}${r.error ? ` (${r.error})` : ""} run ${r.id}`,
      ),
    );
  }
  out.push(
    "",
    "## Recent config changes",
    "",
    ...(inv.history.length
      ? inv.history.map((e) => "- " + changeLine(e))
      : ["- none"]),
  );
  if (inv.warnings.length)
    out.push("", "## Warnings", "", ...inv.warnings.map((w) => "- " + w));
  return out.join("\n");
}

export function renderModule(
  inv: Inventory,
  id: string,
  history: HistoryEntry[],
) {
  const m = inv.modules.find((x) => x.id === id);
  if (!m) throw new Error(`Module not installed: ${id}`);
  const out = [
    `# module ${m.id}@${m.version} (${m.kind})`,
    `- spec: \`${m.spec}\`, path: ${m.path}`,
    `- requires: ${m.requires.join(", ") || "-"}; required by: ${m.required_by.join(", ") || "-"}`,
    `- records owned: ${m.records}; code: ${m.has_code.join(", ") || "schema only"}`,
    ...(m.linked_to
      ? [
          `- linked → ${m.linked_to}${m.shared ? " (outside project; files the module writes there may be shared with other projects)" : ""}`,
        ]
      : []),
    ...(m.docs ? [`- docs: ${m.docs}`] : []),
    "",
    "## Types",
    ...m.types.map(
      (t) =>
        `- \`${t.name}@${t.version}\` required: ${t.required.join(", ") || "-"}`,
    ),
    "",
    "## Relations",
    ...(m.relations.length
      ? m.relations.map(
          (r) =>
            `- \`${r.name}\`: ${r.from.join("|")} → ${r.to.join("|")}${r.pin ? ` (pin ${r.pin})` : ""}`,
        )
      : ["- none"]),
  ];
  if (m.ejected)
    out.push(
      "",
      "## Eject",
      "- " + customizations({ ...inv, modules: [m] })[0],
    );
  const related = history.filter((e) =>
    e.changes.some((c) => c.target.startsWith(id + " ")),
  );
  out.push(
    "",
    "## History",
    ...(related.length
      ? related.reverse().map((e) => "- " + changeLine(e))
      : ["- none"]),
  );
  return out.join("\n");
}

export function renderPipeline(
  inv: Inventory,
  name: string,
  history: HistoryEntry[],
) {
  const p = inv.pipelines.find((x) => x.name === name);
  if (!p) throw new Error(`Pipeline not configured: ${name}`);
  const runs =
    inv.workspace?.recent_runs.filter((r) => r.pipeline === name) ?? [];
  const related = history.filter((e) =>
    e.changes.some((c) => c.target.startsWith(name + " ")),
  );
  return [
    `# pipeline ${p.name}${p.default ? " (default)" : ""}`,
    `- use: \`${p.use}\`${p.id ? ` → ${p.id}@${p.version}` : ""}`,
    `- adoption: ${p.adoption ? "required (run `cg run production adopt ITEM` first)" : "none"}`,
    ...(p.error ? [`- ERROR: ${p.error}`] : []),
    "",
    "## Operations",
    ...Object.entries(p.operations ?? {}).map(
      ([op, d]) => `- \`bun cg run production ${op} ITEM\`${d ? ": " + d : ""}`,
    ),
    "",
    "## Recent runs",
    ...(runs.length
      ? runs.map(
          (r) =>
            `- ${day(r.at)} ${r.operation} ${r.item ?? ""}: ${r.status} run ${r.id}`,
        )
      : ["- none in last 5"]),
    "",
    "## History",
    ...(related.length
      ? related.reverse().map((e) => "- " + changeLine(e))
      : ["- none"]),
  ].join("\n");
}

export function renderHistory(history: HistoryEntry[], limit: number) {
  const entries = history.slice(-limit).reverse();
  return [
    "# config history (newest first)",
    ...(entries.length ? entries.map((e) => "- " + changeLine(e)) : ["- none"]),
  ].join("\n");
}
