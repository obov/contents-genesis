import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { PACKAGE_ROOT } from "../../core/resolve.ts";
import { readProject, updateProject } from "./project.ts";

const SKILLS_DIR = ".agents/skills";
const LOCAL = "local:";

/** Machine-local skill registry shared across cg projects (no package release needed). */
export const localRegistry = () =>
  process.env.CG_SKILLS_HOME || resolve(homedir(), ".cg/skills");

const isLocal = (spec: string) => spec.startsWith(LOCAL);
/** Directory name under .agents/skills for a project.json skill spec. */
export const skillDirName = (spec: string) =>
  isLocal(spec) ? spec.slice(LOCAL.length) : spec;

const skillDirs = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter(
          (e) =>
            (e.isDirectory() || e.isSymbolicLink()) &&
            existsSync(resolve(dir, e.name, "SKILL.md")),
        )
        .map((e) => e.name)
        .sort()
    : [];

export const availableSkills = () => skillDirs(resolve(PACKAGE_ROOT, "skills"));
export const localSkills = () => skillDirs(localRegistry());

/** Prefer the project's own installed copy so links survive npx cache cleanup. */
function skillSource(root: string, spec: string): string | null {
  const name = skillDirName(spec);
  if (!name || name.includes("/") || name.startsWith("."))
    throw new Error(`Invalid skill name: ${spec}`);
  const candidates = isLocal(spec)
    ? [resolve(localRegistry(), name)]
    : [
        resolve(root, "node_modules/contents-genesis/skills", name),
        resolve(PACKAGE_ROOT, "skills", name),
      ];
  return candidates.find((c) => existsSync(resolve(c, "SKILL.md"))) ?? null;
}

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Claude Code reads .claude/skills; Codex reads .agents/skills. Keep one source. */
function ensureClaudeLink(root: string) {
  const claude = resolve(root, ".claude/skills");
  if (existsSync(claude) || isLink(claude)) return;
  mkdirSync(dirname(claude), { recursive: true });
  symlinkSync("../" + SKILLS_DIR, claude, "dir");
}

function link(root: string, spec: string, source: string) {
  const name = skillDirName(spec),
    target = resolve(root, SKILLS_DIR, name);
  mkdirSync(dirname(target), { recursive: true });
  if (isLink(target)) rmSync(target);
  else if (existsSync(target))
    throw new Error(
      `${SKILLS_DIR}/${name} is a project-owned skill; rename it or remove it first`,
    );
  // Package skills stay relative (node_modules moves with the project);
  // local registry skills live outside the project, so link absolutely.
  symlinkSync(
    isLocal(spec) ? source : relative(dirname(target), source),
    target,
    "dir",
  );
  ensureClaudeLink(root);
}

function requireSource(root: string, spec: string) {
  const source = skillSource(root, spec);
  if (source) return source;
  throw new Error(
    isLocal(spec)
      ? `Local skill not found in ${localRegistry()}: ${skillDirName(spec)}`
      : `Unknown shared skill: ${spec}`,
  );
}

/** A local: spec and a package spec must not claim the same directory. */
function assertNoClash(specs: string[], spec: string) {
  const name = skillDirName(spec),
    other = specs.find((s) => s !== spec && skillDirName(s) === name);
  if (other)
    throw new Error(`${spec} conflicts with ${other}; remove ${other} first`);
}

export function listSkills(root: string) {
  const specs = readProject(root).skills ?? [],
    dir = resolve(root, SKILLS_DIR),
    present = existsSync(dir) ? readdirSync(dir) : [],
    linked = (spec: string) => isLink(resolve(dir, skillDirName(spec)));
  return {
    shared: specs
      .filter((s) => !isLocal(s))
      .map((name) => ({ name, linked: linked(name) })),
    local: specs
      .filter(isLocal)
      .map((name) => ({ name, linked: linked(name) })),
    project: present.filter(
      (name) => !isLink(resolve(dir, name)) && !name.startsWith("."),
    ),
    available: availableSkills().filter((n) => !specs.includes(n)),
    available_local: localSkills()
      .map((n) => LOCAL + n)
      .filter((s) => !specs.includes(s)),
    registry: localRegistry(),
  };
}

export function addSkill(root: string, spec: string) {
  assertNoClash(readProject(root).skills ?? [], spec);
  link(root, spec, requireSource(root, spec));
  updateProject(root, (c) => {
    c.skills = [...new Set([...(c.skills ?? []), spec])];
  });
  return { linked: spec };
}

export function removeSkill(root: string, spec: string) {
  const target = resolve(root, SKILLS_DIR, skillDirName(spec));
  if (existsSync(target) && !isLink(target))
    throw new Error(`${spec} is a project-owned skill; delete it manually`);
  if (isLink(target)) rmSync(target);
  updateProject(root, (c) => {
    c.skills = (c.skills ?? []).filter((s) => s !== spec);
  });
  return { unlinked: spec };
}

/** Move a project-owned skill into the local registry and link it back as local:<name>. */
export function publishSkill(root: string, name: string) {
  const bare = skillDirName(name),
    from = resolve(root, SKILLS_DIR, bare),
    to = resolve(localRegistry(), bare);
  if (isLink(from) || !existsSync(resolve(from, "SKILL.md")))
    throw new Error(`${SKILLS_DIR}/${bare} is not a project-owned skill`);
  if (existsSync(to))
    throw new Error(`Local registry already has ${bare}: ${to}`);
  assertNoClash(readProject(root).skills ?? [], LOCAL + bare);
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    // Cross-device move: copy then delete.
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
  }
  const result = addSkill(root, LOCAL + bare);
  return { published: bare, registry: to, ...result };
}

/**
 * Recreate every skill link from project.json (e.g. after clone).
 * Local skills missing from this machine's registry are reported, not fatal.
 */
export function linkSkills(root: string) {
  const specs = readProject(root).skills ?? [],
    linked: string[] = [],
    missing: string[] = [];
  for (const spec of specs) {
    const source = isLocal(spec)
      ? skillSource(root, spec)
      : requireSource(root, spec);
    if (!source) {
      missing.push(spec);
      continue;
    }
    link(root, spec, source);
    linked.push(spec);
  }
  if (specs.length) ensureClaudeLink(root);
  return {
    linked,
    missing,
    broken: linked.filter(
      (s) => !existsSync(resolve(root, SKILLS_DIR, skillDirName(s), "SKILL.md")),
    ),
  };
}
