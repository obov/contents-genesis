import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hash, readJson, within } from "../../core/files.ts";
import type { ProjectConfig } from "../../core/model.ts";

export function checkArchitecture(root: string) {
  const directory = resolve(root, "architecture");
  const registry = readJson<{
    current_version: string;
    releases: {
      version: string;
      parent: string | null;
      snapshot: string;
      sha256: string;
    }[];
  }>(resolve(directory, "registry.json"));
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const release of registry.releases) {
    if (seen.has(release.version))
      throw new Error("Duplicate architecture release");
    const bytes = readFileSync(within(directory, release.snapshot));
    if (hash(bytes) !== release.sha256)
      throw new Error(
        "Architecture snapshot hash mismatch: " + release.version,
      );
    const snapshot = JSON.parse(bytes.toString()) as {
      version: string;
      parent: string | null;
      documents: { path: string; content: string; sha256: string }[];
    };
    if (
      snapshot.version !== release.version ||
      snapshot.parent !== release.parent ||
      release.parent !== previous
    )
      throw new Error("Invalid architecture parent chain");
    const paths = new Set<string>();
    for (const doc of snapshot.documents) {
      if (paths.has(doc.path) || hash(doc.content) !== doc.sha256)
        throw new Error("Invalid architecture document: " + doc.path);
      paths.add(doc.path);
    }
    seen.add(release.version);
    previous = release.version;
  }
  const project = readJson<ProjectConfig>(resolve(root, "project.json"));
  if (!project.architecture)
    throw new Error("project.json has no architecture target");
  const architecture = project.architecture;
  const target = registry.releases.find(
    (r) => r.version === architecture.target_version,
  );
  if (
    !target ||
    target.sha256 !== architecture.target_snapshot_sha256 ||
    registry.current_version !== previous
  )
    throw new Error("Invalid architecture target");
  return {
    target: target.version,
    snapshots: seen.size,
    implemented_version: architecture.implemented_version,
  };
}
