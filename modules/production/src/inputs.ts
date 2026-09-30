import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { Catalog } from "contents-genesis/core";
import { draft, relationDraft, within } from "contents-genesis/core";
import type { Draft, RecordData, Ref } from "contents-genesis/core";
import {
  assertPinnedFiles,
  pinFiles,
  type FilePin,
} from "contents-genesis/runtime";
import type { InputSource, ProductionItem } from "./pipeline.ts";

// Adoption is format-agnostic: a pipeline supplies script text + input files.
const folderOf = (selector: string, item: ProductionItem) =>
  typeof item.folder === "string" && item.folder ? item.folder : selector;

const compact = (text: string) => text.replace(/\s/g, "");

// Alias namespaces are scoped by the project ID from project.json.
function aliasesFor(
  catalog: Catalog,
  selector: string,
  folder: string,
  value: string,
) {
  const base = catalog.config.id + ":production";
  return [
    { namespace: base, value: value + ":" + selector },
    { namespace: base + ":" + folder, value },
  ];
}

export function findProjectRecord(
  catalog: Catalog,
  selector: string,
  item: ProductionItem,
) {
  const folder = folderOf(selector, item);
  const records = [...catalog.snapshot().latest.values()].filter(
    (record) => record.type === "production.project",
  );
  return (
    records.find((record) =>
      record.aliases.some(
        (alias) =>
          alias.value === "project:" + selector ||
          (alias.namespace.includes(folder) && alias.value === "production"),
      ),
    ) ??
    records.find(
      (record) =>
        record.attributes.project_id === selector ||
        record.attributes.legacy_id === selector,
    )
  );
}

export function findScriptRecord(
  catalog: Catalog,
  selector: string,
  item: ProductionItem,
) {
  const folder = folderOf(selector, item);
  const records = [...catalog.snapshot().latest.values()].filter(
    (record) => record.type === "production.script",
  );
  return (
    records.find((record) =>
      record.aliases.some(
        (alias) =>
          alias.value === "script:" + selector ||
          (alias.namespace.includes(folder) && alias.value === "script"),
      ),
    ) ??
    records.find(
      (record) =>
        record.attributes.project_id === selector ||
        record.attributes.legacy_project_id === selector,
    )
  );
}

/** Existing, contained input paths for a pipeline-declared source. */
export function checkedInputPaths(inputs: string, source: InputSource) {
  if (!source.text.trim())
    throw new Error("Pipeline returned empty script text");
  for (const path of source.files) {
    if (!existsSync(within(inputs, path)))
      throw new Error("Missing production input: " + path);
  }
  return source.files;
}

const MEDIA: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".json": "application/json",
  ".ts": "text/typescript",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".yaml": "application/yaml",
};
export const mediaType = (path: string) =>
  MEDIA[extname(path).toLowerCase()] ?? "application/octet-stream";

function draftFromExisting(
  existing: RecordData,
  attributes: Record<string, unknown>,
  locators: RecordData["locators"],
): Draft {
  return {
    id: existing.id,
    type: existing.type,
    type_version: existing.type_version,
    owner: existing.owner,
    title: existing.title,
    attributes,
    aliases: existing.aliases,
    locators,
    extensions: existing.extensions,
    lifecycle: existing.lifecycle,
  };
}

export async function adoptInputs(
  catalog: Catalog,
  inputs: string,
  selector: string,
  item: ProductionItem,
  source: InputSource,
  sourceRunId?: string,
): Promise<{ project: Ref; script: Ref; pins: FilePin[]; changed: boolean }> {
  const text = source.text,
    files = checkedInputPaths(inputs, source),
    pins = pinFiles(inputs, files),
    folder = folderOf(selector, item);
  let projectRecord = findProjectRecord(catalog, selector, item);
  const projectMutations: { expected_revision: number; record: Draft }[] = [];
  if (!projectRecord) {
    const record = draft(
      "production",
      "production.project",
      selector,
      { production_status: "in_progress", project_id: selector },
      { aliases: aliasesFor(catalog, selector, folder, "project") },
    );
    projectMutations.push({ expected_revision: 0, record });
    projectRecord = { ...record, revision: 1 } as RecordData;
  }

  const existing = findScriptRecord(catalog, selector, item);
  const locators = files.map((path) =>
    catalog.putFile(resolve(inputs, path), mediaType(path), "production_input"),
  );
  const attributes = {
    ...(existing?.attributes ?? {}),
    text,
    project_id: selector,
    legacy_project_id: existing?.attributes.legacy_project_id ?? selector,
    adopted_inputs: pins,
    adopted_at: new Date().toISOString(),
    adopted_from_run: sourceRunId ?? null,
  };
  const same =
    !!existing &&
    compact(String(existing.attributes.text ?? "")) === compact(text) &&
    JSON.stringify(existing.attributes.adopted_inputs ?? null) ===
      JSON.stringify(pins) &&
    JSON.stringify(existing.locators.map((locator) => locator.sha256)) ===
      JSON.stringify(locators.map((locator) => locator.sha256));

  let scriptDraft: Draft;
  let expectedRevision: number;
  if (existing) {
    scriptDraft = draftFromExisting(existing, attributes, locators);
    expectedRevision = existing.revision;
  } else {
    scriptDraft = draft(
      "production",
      "production.script",
      selector + " script",
      attributes,
      {
        aliases: aliasesFor(catalog, selector, folder, "script"),
        locators,
      },
    );
    expectedRevision = 0;
  }

  const mutations = [...projectMutations];
  if (!same)
    mutations.push({
      expected_revision: expectedRevision,
      record: scriptDraft,
    });

  const scriptId = existing?.id ?? scriptDraft.id;
  const scriptRevision = same ? existing!.revision : expectedRevision + 1;
  const projectId = projectRecord.id;
  const hasBelongsTo = [...catalog.snapshot().latest.values()].some(
    (record) =>
      record.type === "core.relation" &&
      record.lifecycle === "active" &&
      record.relation?.predicate === "production.belongs_to" &&
      record.relation.from.id === scriptId &&
      record.relation.to.id === projectId,
  );
  if (!hasBelongsTo) {
    mutations.push({
      expected_revision: 0,
      record: relationDraft(
        "production",
        "production.belongs_to",
        { id: scriptId },
        { id: projectId },
        { scope: { basis: "Explicit production input adoption" } },
      ),
    });
  }

  if (mutations.length) catalog.commit(mutations, "process:production-adopt");
  return {
    project: {
      id: projectId,
      revision: projectMutations.length > 0 ? 1 : projectRecord.revision,
    },
    script: { id: scriptId, revision: scriptRevision },
    pins,
    changed: !same || projectMutations.length > 0 || !hasBelongsTo,
  };
}

export async function requireAdoptedInputs(
  catalog: Catalog,
  inputs: string,
  selector: string,
  item: ProductionItem,
  source: InputSource,
) {
  const script = findScriptRecord(catalog, selector, item);
  if (!script || !Array.isArray(script.attributes.adopted_inputs))
    throw new Error(
      "Production inputs are not adopted; run production adopt " + selector,
    );
  // Pins first: a changed file is the more precise error.
  assertPinnedFiles(inputs, script.attributes.adopted_inputs as FilePin[]);
  if (compact(source.text) !== compact(String(script.attributes.text ?? "")))
    throw new Error(
      "Adopted script text differs from current production script",
    );
  const projectRecord = findProjectRecord(catalog, selector, item);
  if (!projectRecord)
    throw new Error("Production project record is missing: " + selector);
  return {
    script,
    project: projectRecord,
  };
}

/** Copy stage files produced by an earlier run back into the inputs. */
export function adoptRunFiles(stage: string, inputs: string, files: string[]) {
  for (const path of files) {
    const source = within(stage, path),
      destination = within(inputs, path);
    if (!existsSync(source))
      throw new Error("Run candidate missing file: " + path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}
