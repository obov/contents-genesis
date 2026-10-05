/**
 * Release gate for per-unit versions. Each builtin module (module.json
 * `version`) and shared skill (SKILL.md `metadata.version`) is versioned on its
 * own; any content change since the previous release tag must raise that
 * unit's version. Usage: bun scripts/check-versions.ts [BASE_REF]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import semver from "semver";
import { parseSkillVersion } from "../src/cli/skills.ts";

const root = resolve(import.meta.dir, "..");
const git = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout.trim() };
};

// Base = last release. A clean, tagged HEAD is the release being validated,
// so compare it with the tag before; otherwise compare with the nearest tag.
function previousRelease() {
  const nearest = git("describe", "--tags", "--abbrev=0").out;
  const atHead =
    nearest &&
    git("rev-parse", nearest + "^{commit}").out ===
      git("rev-parse", "HEAD").out;
  if (atHead && git("diff", "--quiet", "HEAD", "--", "modules", "skills").ok)
    return git("describe", "--tags", "--abbrev=0", "HEAD~1").out;
  return nearest;
}
const base = process.argv[2] ?? previousRelease();
if (!base || !git("rev-parse", "--verify", "--quiet", base + "^{commit}").ok) {
  console.log("check-versions: no base release tag (shallow clone?); skipped");
  process.exit(0);
}

type Unit = {
  path: string;
  file: string;
  read: (text: string) => string | null;
};
const units: Unit[] = [];
const dirs = (folder: string, marker: string) =>
  readdirSync(resolve(root, folder), { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() && existsSync(resolve(root, folder, e.name, marker)),
    )
    .map((e) => `${folder}/${e.name}`);
for (const path of dirs("modules", "module.json"))
  units.push({
    path,
    file: "module.json",
    read: (text) => (JSON.parse(text) as { version?: string }).version ?? null,
  });
for (const path of dirs("skills", "SKILL.md"))
  units.push({ path, file: "SKILL.md", read: parseSkillVersion });

const errors: string[] = [],
  bumped: string[] = [];
for (const unit of units) {
  const current = unit.read(
    readFileSync(resolve(root, unit.path, unit.file), "utf8"),
  );
  if (!current || !semver.valid(current)) {
    errors.push(
      `${unit.path}: missing or invalid version (${current ?? "none"}) in ${unit.file}`,
    );
    continue;
  }
  // Working tree vs base, so uncommitted edits are checked locally too.
  if (git("diff", "--quiet", base, "--", unit.path).ok) continue;
  const old = git("show", `${base}:${unit.path}/${unit.file}`),
    previous = old.ok ? unit.read(old.out) : null;
  if (!previous) {
    bumped.push(`${unit.path} ${current} (new or first versioned)`);
    continue;
  }
  if (!semver.valid(previous) || semver.gt(current, previous))
    bumped.push(`${unit.path} ${previous} → ${current}`);
  else
    errors.push(
      `${unit.path}: changed since ${base} but version not raised (${previous} → ${current})`,
    );
}

for (const line of bumped) console.log("check-versions: " + line);
if (errors.length) {
  for (const line of errors) console.error("check-versions: " + line);
  process.exit(1);
}
console.log(`check-versions: ${units.length} units ok against ${base}`);
